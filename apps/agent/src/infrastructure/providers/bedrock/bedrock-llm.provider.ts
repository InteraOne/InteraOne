import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import { LLMProvider } from "../base/llm.provider";
import {
  LLMMessage,
  LLMOptions,
  LLMGenerateResult,
  LLMTokenUsage,
  LLMGenerateStep,
  ModelCapabilities,
} from "../types/ai.types";
import { getLLMModelConfig } from "../registry/model.registry";
import config from "../../../config";
import { trackAICall } from "../observability/observability.queue";
import { estimateCost } from "../observability/cost-tracker";
import { LatencyTracker } from "../observability/latency-tracker";
import { TokenTracker } from "../observability/token-tracker";
import {
  cleanFinalResponse,
  TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION,
} from "../utils/tool-limit";
import { buildToolInputSchema } from "../utils/tool-schema";

export class BedrockLLMProvider implements LLMProvider {
  readonly name = "bedrock";
  private client?: BedrockRuntimeClient;
  private defaultModel: string;

  constructor() {
    const bedrockConfig = config.llm.bedrock;
    this.defaultModel = bedrockConfig?.model || "openai.gpt-oss-20b-1:0";
  }

  private getClient(): BedrockRuntimeClient {
    if (!this.client) {
      const bedrockConfig = config.llm.bedrock;
      if (!bedrockConfig) {
        throw new Error("Bedrock configuration is missing in config");
      }

      const clientConfig: Record<string, unknown> = {
        region: bedrockConfig.region || "us-east-1",
        requestTimeout: parseInt(process.env.BEDROCK_TIMEOUT_MS || "15000", 10),
      };

      if (bedrockConfig.accessKeyId && bedrockConfig.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: bedrockConfig.accessKeyId,
          secretAccessKey: bedrockConfig.secretAccessKey,
        };
      }

      this.client = new BedrockRuntimeClient(clientConfig as any);
    }
    return this.client;
  }

  async generate(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMGenerateResult> {
    const latencyTracker = new LatencyTracker();
    latencyTracker.start();
    const tokenTracker = new TokenTracker();
    const model = options.model ?? this.defaultModel;
    const maxTimeoutMs = parseInt(
      process.env.BEDROCK_MAX_TIMEOUT_MS || "30000",
      10,
    );

    try {
      const result = await Promise.race([
        this.executeGenerate(messages, options, tokenTracker),
        new Promise<LLMGenerateResult>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Bedrock generation timed out after ${maxTimeoutMs}ms`,
                ),
              ),
            maxTimeoutMs,
          ),
        ),
      ]);

      const totalUsage = tokenTracker.toUsage();
      const latencyMs = latencyTracker.stopMs();
      const estimatedCost = estimateCost(
        "bedrock",
        model,
        totalUsage.promptTokens ?? 0,
        totalUsage.completionTokens ?? 0,
      );

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "bedrock",
        modelId: model,
        callType: "llm",
        latencyMs,
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        estimatedCostUsd: estimatedCost,
        success: true,
        organizationId: options.toolContext?.organizationId,
        conversationId: options.toolContext?.conversationId,
      });

      return result;
    } catch (err: any) {
      const totalUsage = tokenTracker.toUsage();
      const latencyMs = latencyTracker.stopMs();
      const estimatedCost = estimateCost(
        "bedrock",
        model,
        totalUsage.promptTokens ?? 0,
        totalUsage.completionTokens ?? 0,
      );

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "bedrock",
        modelId: model,
        callType: "llm",
        latencyMs,
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        estimatedCostUsd: estimatedCost,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        organizationId: options.toolContext?.organizationId,
        conversationId: options.toolContext?.conversationId,
      });

      throw err;
    }
  }

  private async executeGenerate(
    messages: LLMMessage[],
    options: LLMOptions,
    tokenTracker: TokenTracker,
  ): Promise<LLMGenerateResult> {
    const client = this.getClient();
    const {
      model = this.defaultModel,
      tools = [],
      toolContext,
      onStream,
      onToolEvent,
    } = options;

    // 1. Separate system instruction
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => ({ text: m.content }));

    // 2. Normalise conversation turns: start with user, alternate roles, merge duplicates
    const nonSystem = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
    const firstUserIndex = nonSystem.findIndex((m) => m.role === "user");
    const filtered =
      firstUserIndex !== -1 ? nonSystem.slice(firstUserIndex) : [];

    if (filtered.length === 0) {
      filtered.push({ role: "user", content: "Hello" });
    }

    const merged: { role: "user" | "assistant"; content: string }[] = [];
    for (const msg of filtered) {
      if (merged.length === 0) {
        merged.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      } else {
        const last = merged[merged.length - 1];
        if (last.role === msg.role) {
          last.content = `${last.content}\n\n${msg.content}`;
        } else {
          merged.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          });
        }
      }
    }

    const converseMessages: Message[] = merged.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    // 3. Map tool definitions to Bedrock schema
    const toolConfig: any =
      tools.length > 0
        ? {
            tools: tools.map((t) => {
              return {
                toolSpec: {
                  name: t.name,
                  description: t.description,
                  inputSchema: {
                    json: buildToolInputSchema(t),
                  },
                },
              };
            }),
          }
        : undefined;

    const MAX_TOOL_LOOPS = 5;
    const createTicketResults = new Map<string, unknown>();
    const steps: LLMGenerateStep[] = [];

    let loop = 0;
    let responseText = "";

    while (loop < MAX_TOOL_LOOPS) {
      loop++;
      responseText = "";
      let toolUses: Array<{
        toolUseId: string;
        name: string;
        input: unknown;
      }> = [];

      let runStream = !!onStream;
      let streamResponse: any = null;

      if (runStream) {
        try {
          const command = new ConverseStreamCommand({
            modelId: model,
            messages: converseMessages,
            system,
            toolConfig,
          });
          streamResponse = await client.send(command);
        } catch (streamErr: unknown) {
          const err = streamErr as { name?: string; message?: string };
          if (
            err.name === "ValidationException" ||
            err.message?.toLowerCase().includes("streaming mode") ||
            err.message?.toLowerCase().includes("tool use in streaming")
          ) {
            console.warn(
              `[BedrockLLMProvider] Model ${model} does not support tool use in streaming, falling back to non-streaming.`,
            );
            runStream = false;
          } else {
            throw streamErr;
          }
        }
      }

      if (runStream && streamResponse) {
        let activeToolUse: {
          toolUseId: string;
          name: string;
          inputString: string;
        } | null = null;

        let insideThinking = false;
        const resp = streamResponse as unknown as {
          stream?: AsyncIterable<Record<string, unknown>>;
        };
        if (resp.stream) {
          for await (const chunk of resp.stream) {
            const delta = (
              chunk as {
                contentBlockDelta?: {
                  delta?: { text?: string; toolUse?: { input?: string } };
                };
              }
            ).contentBlockDelta?.delta;

            if (delta?.text) {
              // Strip <thinking>/<thought> tags and their content before streaming
              let cleanText = delta.text
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
                .replace(/<\/?(?:thinking|thought)>/gi, "");

              // If this chunk is inside an unclosed thinking block, skip it entirely
              responseText += delta.text;
              const lastOpenThinking = responseText.lastIndexOf("<thinking>");
              const lastCloseThinking = responseText.lastIndexOf("</thinking>");
              const lastOpenThought = responseText.lastIndexOf("<thought>");
              const lastCloseThought = responseText.lastIndexOf("</thought>");

              insideThinking =
                (lastOpenThinking !== -1 &&
                  lastOpenThinking > lastCloseThinking) ||
                (lastOpenThought !== -1 && lastOpenThought > lastCloseThought);

              if (insideThinking || !cleanText) {
                // Don't stream thinking content or empty chunks
                continue;
              }

              onStream?.(cleanText, false);
            }

            const blockStart = (
              chunk as {
                contentBlockStart?: {
                  start?: { toolUse?: { toolUseId?: string; name?: string } };
                };
              }
            ).contentBlockStart?.start?.toolUse;
            if (blockStart) {
              activeToolUse = {
                toolUseId: blockStart.toolUseId || "",
                name: blockStart.name || "",
                inputString: "",
              };
            }

            if (delta?.toolUse?.input && activeToolUse) {
              activeToolUse.inputString += delta.toolUse.input;
            }

            if (
              (chunk as { contentBlockStop?: unknown }).contentBlockStop &&
              activeToolUse
            ) {
              try {
                const input = JSON.parse(
                  activeToolUse.inputString || "{}",
                ) as unknown;
                toolUses.push({
                  toolUseId: activeToolUse.toolUseId,
                  name: activeToolUse.name,
                  input,
                });
              } catch {
                console.error(
                  "Failed to parse tool use input JSON:",
                  activeToolUse.inputString,
                );
              }
              activeToolUse = null;
            }

            const metaUsage = (
              chunk as {
                metadata?: {
                  usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                  };
                };
              }
            ).metadata?.usage;
            if (metaUsage) {
              const u = {
                promptTokens: metaUsage.inputTokens,
                completionTokens: metaUsage.outputTokens,
                totalTokens:
                  (metaUsage.inputTokens || 0) + (metaUsage.outputTokens || 0),
              };
              tokenTracker.accumulate(u);
            }
          }
        }
      } else {
        const command = new ConverseCommand({
          modelId: model,
          messages: converseMessages,
          system,
          toolConfig,
        });

        const response = await client.send(command);

        if (response.output?.message?.content) {
          for (const block of response.output.message.content) {
            if (block.text) {
              responseText += block.text;
            }
            if (block.toolUse) {
              toolUses.push({
                toolUseId: block.toolUse.toolUseId ?? "",
                name: block.toolUse.name ?? "",
                input: block.toolUse.input,
              });
            }
          }
        }

        if (response.usage) {
          const u = {
            promptTokens: response.usage.inputTokens,
            completionTokens: response.usage.outputTokens,
            totalTokens:
              (response.usage.inputTokens || 0) +
              (response.usage.outputTokens || 0),
          };
          tokenTracker.accumulate(u);
        }
      }

      if (toolUses.length === 0) {
        const cleanText = responseText
          .replace(/<(thinking|thought)>[\s\S]*?<\/\1>/gi, "")
          .replace(/<(thinking|thought)>[\s\S]*$/gi, "")
          .replace(/<\/?(?:thinking|thought)>/gi, "")
          .trim();
        return {
          text: cleanText || "Sorry, I could not generate a response.",
          usage: tokenTracker.toUsage(),
          steps,
        };
      }

      converseMessages.push({
        role: "assistant",
        content: toolUses.map((tu) => ({
          toolUse: {
            toolUseId: tu.toolUseId,
            name: tu.name,
            input: tu.input,
          },
        })) as any,
      });

      const toolResultsContent: unknown[] = [];
      for (const call of toolUses) {
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) continue;

        const toolLabels: Record<string, { label: string; detail?: string }> = {
          faq_retrieval: { label: "Searching FAQs" },
          knowledge_retrieval: { label: "Searching uploaded knowledge" },
          web_crawl: { label: "Searching web" },
          conversation_memory: { label: "Checking conversation history" },
          seek_contact: { label: "Looking up contact" },
          create_ticket: { label: "Creating ticket" },
          update_ticket: { label: "Updating ticket" },
          close_ticket: { label: "Closing ticket" },
          send_email: { label: "Sending email" },
          escalate_to_human: { label: "Connecting to human agent" },
          verify_email_otp: { label: "Verifying code" },
          update_contact_profile: { label: "Saving contact details" },
          mark_query_resolved: { label: "Marking query resolved" },
        };

        const toolMeta = toolLabels[call.name] || { label: "Working on it" };

        // Emit tool start event
        if (onToolEvent) {
          onToolEvent({
            type: "start",
            toolName: call.name,
            label: toolMeta.label,
          });
        }

        let result: unknown;
        let stepError: string | undefined;
        const stepTimestamp = new Date();
        const sanitizedInput = {
          ...((call.input as Record<string, unknown>) || {}),
          ...(toolContext?.conversationId
            ? { conversationId: toolContext.conversationId }
            : {}),
          ...(toolContext?.organizationId
            ? { organizationId: toolContext.organizationId }
            : {}),
        };

        try {
          const requestKey = `${toolContext?.organizationId || ""}:${toolContext?.conversationId || ""}:${toolContext?.messageId || ""}`;
          if (
            call.name === "create_ticket" &&
            createTicketResults.has(requestKey)
          ) {
            result = createTicketResults.get(requestKey);
          } else {
            result = await tool.execute(sanitizedInput, toolContext);
            if (call.name === "create_ticket") {
              createTicketResults.set(requestKey, result);
            }
          }

          toolResultsContent.push({
            toolResult: {
              toolUseId: call.toolUseId,
              status: "success",
              content: [
                {
                  json:
                    typeof result === "string"
                      ? (JSON.parse(result) as object)
                      : (result as object),
                },
              ],
            },
          });

          // Emit tool complete event
          if (onToolEvent) {
            let detail: string | undefined;
            if (
              (call.name === "faq_retrieval" ||
                call.name === "knowledge_retrieval") &&
              result &&
              typeof result === "object"
            ) {
              const r = result as any;
              if (r.results && Array.isArray(r.results)) {
                detail = `Retrieved ${r.results.length} document${r.results.length !== 1 ? "s" : ""}`;
              } else if (r.status === "no_results") {
                detail = "No relevant content found";
              }
            } else if (
              call.name === "create_ticket" &&
              result &&
              typeof result === "object"
            ) {
              const r = result as any;
              if (r.ticketNumber) detail = `Ticket ${r.ticketNumber}`;
            } else if (call.name === "web_crawl") {
              detail = "Content retrieved";
            }

            onToolEvent({
              type: "complete",
              toolName: call.name,
              label: toolMeta.label,
              detail,
            });
          }
        } catch (e: unknown) {
          stepError = e instanceof Error ? e.message : String(e);
          result = { error: stepError };
          toolResultsContent.push({
            toolResult: {
              toolUseId: call.toolUseId,
              status: "error",
              content: [{ text: stepError }],
            },
          });

          // Emit tool complete event with error detail
          if (onToolEvent) {
            onToolEvent({
              type: "complete",
              toolName: call.name,
              label: toolMeta.label,
              detail: "Failed",
            });
          }
        }

        steps.push({
          toolName: call.name,
          args: sanitizedInput,
          result,
          error: stepError,
          timestamp: stepTimestamp,
        });
      }

      converseMessages.push({
        role: "user",
        content: toolResultsContent as any,
      });
    }

    responseText = "";
    const finalSystem = [
      ...system,
      { text: TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION },
    ];

    if (onStream) {
      const finalResponse = await client.send(
        new ConverseStreamCommand({
          modelId: model,
          messages: converseMessages,
          system: finalSystem,
        }),
      );

      if (finalResponse.stream) {
        for await (const chunk of finalResponse.stream) {
          const text = chunk.contentBlockDelta?.delta?.text;
          if (text) {
            responseText += text;
            onStream(text, false);
          }

          const usage = chunk.metadata?.usage;
          if (usage) {
            tokenTracker.accumulate({
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
            });
          }
        }
      }
    } else {
      const finalResponse = await client.send(
        new ConverseCommand({
          modelId: model,
          messages: converseMessages,
          system: finalSystem,
        }),
      );

      for (const block of finalResponse.output?.message?.content || []) {
        if (block.text) responseText += block.text;
      }
      if (finalResponse.usage) {
        tokenTracker.accumulate({
          promptTokens: finalResponse.usage.inputTokens,
          completionTokens: finalResponse.usage.outputTokens,
          totalTokens:
            (finalResponse.usage.inputTokens || 0) +
            (finalResponse.usage.outputTokens || 0),
        });
      }
    }

    const finalCleanText = cleanFinalResponse(responseText);

    return {
      text:
        finalCleanText ||
        "I’m sorry, but I could not produce a final response from the available information.",
      usage: tokenTracker.toUsage(),
      steps,
    };
  }

  async getCapabilities(modelId?: string): Promise<ModelCapabilities> {
    const activeModel = modelId ?? this.defaultModel;
    // Registry is the single source of truth — no string matching
    const config = getLLMModelConfig(activeModel);
    return {
      modelId: activeModel,
      provider: config.provider,
      contextWindow: config.contextWindow,
      supportsStreaming: config.supportsStreaming,
      supportsTools: config.supportsTools,
      supportsVision: config.supportsVision,
      supportsReasoning: config.supportsReasoning,
    };
  }
}
