import axios from "axios";
import { LLMProvider } from "../base/llm.provider";
import {
  LLMGenerateResult,
  LLMMessage,
  LLMOptions,
  LLMGenerateStep,
  LLMTokenUsage,
  ModelCapabilities,
  ToolEventData,
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

export class OllamaLLMProvider implements LLMProvider {
  readonly name = "ollama";
  private defaultModel: string;
  private baseUrl: string;

  constructor() {
    const ollamaConfig = config.llm.ollama;
    const host = ollamaConfig?.host || "localhost";
    const port = ollamaConfig?.port || 11434;
    this.baseUrl = `http://${host}:${port}`;
    this.defaultModel = ollamaConfig?.model || "llama3.2";
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
      process.env.OLLAMA_MAX_TIMEOUT_MS || "60000",
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
                  `Ollama generation timed out after ${maxTimeoutMs}ms`,
                ),
              ),
            maxTimeoutMs,
          ),
        ),
      ]);

      const totalUsage = tokenTracker.toUsage();
      const latencyMs = latencyTracker.stopMs();
      const estimatedCost = estimateCost("ollama", model, 0, 0);

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "ollama",
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
      const latencyMs = latencyTracker.stopMs();
      const totalUsage = tokenTracker.toUsage();

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "ollama",
        modelId: model,
        callType: "llm",
        latencyMs,
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        estimatedCostUsd: 0,
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
    const {
      model = this.defaultModel,
      tools = [],
      toolContext,
      onStream,
      onToolEvent,
    } = options;

    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const nonSystem = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );

    const ollamaMessages: any[] = nonSystem.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const toolLabels: Record<string, string> = {
      faq_retrieval: "Searching FAQs",
      knowledge_retrieval: "Searching uploaded knowledge",
      web_crawl: "Searching web",
      conversation_memory: "Checking conversation history",
      seek_contact: "Looking up contact",
      create_ticket: "Creating ticket",
      update_ticket: "Updating ticket",
      close_ticket: "Closing ticket",
      send_email: "Sending email",
      escalate_to_human: "Connecting to human agent",
      verify_email_otp: "Verifying code",
      update_contact_profile: "Saving contact details",
      mark_query_resolved: "Marking query resolved",
    };

    const ollamaTools =
      tools.length > 0
        ? tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: buildToolInputSchema(t),
              },
            }))
        : undefined;

    const MAX_TOOL_LOOPS = 5;
    const steps: LLMGenerateStep[] = [];
    let loop = 0;
    let responseText = "";

    while (loop < MAX_TOOL_LOOPS) {
      loop++;
      responseText = "";

      const payload: any = {
        model,
        messages: ollamaMessages,
        stream: !!onStream,
      };
      if (system) payload.system = system;
      if (ollamaTools) payload.tools = ollamaTools;

      let toolCalls: Array<{
        id: string;
        function: { name: string; arguments: string };
      }> = [];

      if (onStream) {
        const response = await axios.post(`${this.baseUrl}/api/chat`, payload, {
          responseType: "stream",
          timeout: parseInt(process.env.OLLAMA_MAX_TIMEOUT_MS || "60000", 10),
        });

        for await (const chunk of response.data) {
          const lines = chunk.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.message?.content) {
                responseText += data.message.content;

                let cleanText = data.message.content
                  .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                  .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
                  .replace(/<\/?(?:thinking|thought)>/gi, "");

                // Preserve standalone spaces/newlines emitted as their own delta.
                if (cleanText.length > 0) {
                  onStream(cleanText, false);
                }
              }

              if (data.message?.tool_calls) {
                for (const tc of data.message.tool_calls) {
                  toolCalls.push({
                    id: tc.function?.name || `call_${Date.now()}`,
                    function: {
                      name: tc.function?.name || "",
                      arguments: tc.function?.arguments || "{}",
                    },
                  });
                }
              }

              if (data.done) {
                if (data.prompt_eval_count) {
                  tokenTracker.accumulate({
                    promptTokens: data.prompt_eval_count,
                    completionTokens: data.eval_count || 0,
                    totalTokens:
                      (data.prompt_eval_count || 0) + (data.eval_count || 0),
                  });
                }
              }
            } catch {
              // partial JSON — skip
            }
          }
        }
      } else {
        const response = await axios.post(
          `${this.baseUrl}/api/chat`,
          { ...payload, stream: false },
          {
            timeout: parseInt(process.env.OLLAMA_MAX_TIMEOUT_MS || "60000", 10),
          },
        );

        const data = response.data;
        responseText = data.message?.content || "";

        if (data.message?.tool_calls) {
          for (const tc of data.message.tool_calls) {
            toolCalls.push({
              id: tc.function?.name || `call_${Date.now()}`,
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "{}",
              },
            });
          }
        }

        if (data.prompt_eval_count) {
          tokenTracker.accumulate({
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          });
        }
      }

      if (toolCalls.length === 0) {
        const cleanText = responseText
          .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
          .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
          .replace(/<(thinking|thought)>[\s\S]*$/gi, "")
          .replace(/<\/?(?:thinking|thought)>/gi, "")
          .trim();

        return {
          text: cleanText || "Sorry, I could not generate a response.",
          usage: tokenTracker.toUsage(),
          steps,
        };
      }

      // Add assistant message with tool calls
      ollamaMessages.push({
        role: "assistant",
        content: responseText || "",
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      const executeSingleToolCall = async (call: typeof toolCalls[number]) => {
        const tool = tools.find((t) => t.name === call.function.name);
        if (!tool) return;

        const toolMeta = toolLabels[call.function.name] || "Working on it";

        if (onToolEvent) {
          onToolEvent({
            type: "start",
            toolName: call.function.name,
            label: toolMeta,
          });
        }

        let result: unknown;
        let stepError: string | undefined;
        const stepTimestamp = new Date();

        let parsedInput: Record<string, unknown> = {};
        let inputParseError: string | undefined;
        try {
          parsedInput = JSON.parse(call.function.arguments);
          if (!parsedInput || typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
            inputParseError = "Tool arguments must be a JSON object";
            parsedInput = {};
          }
        } catch {
          inputParseError = "The model produced invalid JSON tool arguments";
        }

        const sanitizedInput = {
          ...parsedInput,
          ...(toolContext?.conversationId
            ? { conversationId: toolContext.conversationId }
            : {}),
          ...(toolContext?.organizationId
            ? { organizationId: toolContext.organizationId }
            : {}),
        };

        try {
          if (inputParseError) throw new Error(inputParseError);
          result = await tool.execute(sanitizedInput, toolContext);

          ollamaMessages.push({
            role: "tool",
            content:
              typeof result === "string" ? result : JSON.stringify(result),
          });

          if (onToolEvent) {
            let detail: string | undefined;
            if (
              (call.function.name === "faq_retrieval" ||
                call.function.name === "knowledge_retrieval") &&
              result &&
              typeof result === "object"
            ) {
              const r = result as any;
              if (r.results && Array.isArray(r.results)) {
                detail = `Retrieved ${r.results.length} document${r.results.length !== 1 ? "s" : ""}`;
              }
            } else if (
              call.function.name === "create_ticket" &&
              result &&
              typeof result === "object"
            ) {
              const r = result as any;
              if (r.ticketNumber) detail = `Ticket ${r.ticketNumber}`;
            }

            onToolEvent({
              type: "complete",
              toolName: call.function.name,
              label: toolMeta,
              detail,
            });
          }
        } catch (e: unknown) {
          stepError = e instanceof Error ? e.message : String(e);
          result = { error: stepError };

          ollamaMessages.push({
            role: "tool",
            content: JSON.stringify({ error: stepError }),
          });

          if (onToolEvent) {
            onToolEvent({
              type: "complete",
              toolName: call.function.name,
              label: toolMeta,
              detail: "Failed",
            });
          }
        }

        steps.push({
          toolName: call.function.name,
          args: sanitizedInput,
          result,
          error: stepError,
          timestamp: stepTimestamp,
        });
      };

      // Execute tools
      const sequentialTools = ["create_ticket", "update_ticket", "close_ticket", "send_email", "escalate_to_human"];
      const isSequential = (name: string) =>
        sequentialTools.includes(name) ||
        tools.find((tool) => tool.name === name)?.executionMode === "sequential";
      const parallelCalls = toolCalls.filter((c) => !isSequential(c.function.name));
      const sequentialCalls = toolCalls.filter((c) => isSequential(c.function.name));

      // 1. Run parallel read/retrieval tools concurrently
      if (parallelCalls.length > 0) {
        await Promise.all(parallelCalls.map((call) => executeSingleToolCall(call)));
      }

      // 2. Run sequential write/mutation tools
      for (const call of sequentialCalls) {
        await executeSingleToolCall(call);
      }
    }

    responseText = "";
    const finalPayload = {
      model,
      messages: ollamaMessages,
      system: [system, TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION]
        .filter(Boolean)
        .join("\n\n"),
      stream: !!onStream,
    };

    if (onStream) {
      const finalResponse = await axios.post(
        `${this.baseUrl}/api/chat`,
        finalPayload,
        {
          responseType: "stream",
          timeout: parseInt(process.env.OLLAMA_MAX_TIMEOUT_MS || "60000", 10),
        },
      );

      for await (const chunk of finalResponse.data) {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              responseText += data.message.content;
              onStream(data.message.content, false);
            }
            if (data.done && data.prompt_eval_count) {
              tokenTracker.accumulate({
                promptTokens: data.prompt_eval_count,
                completionTokens: data.eval_count || 0,
                totalTokens:
                  (data.prompt_eval_count || 0) + (data.eval_count || 0),
              });
            }
          } catch {
            // Partial JSON — skip.
          }
        }
      }
    } else {
      const finalResponse = await axios.post(
        `${this.baseUrl}/api/chat`,
        finalPayload,
        { timeout: parseInt(process.env.OLLAMA_MAX_TIMEOUT_MS || "60000", 10) },
      );
      responseText = finalResponse.data.message?.content || "";
      if (finalResponse.data.prompt_eval_count) {
        tokenTracker.accumulate({
          promptTokens: finalResponse.data.prompt_eval_count,
          completionTokens: finalResponse.data.eval_count || 0,
          totalTokens:
            (finalResponse.data.prompt_eval_count || 0) +
            (finalResponse.data.eval_count || 0),
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
    const modelConfig = getLLMModelConfig(activeModel);
    return {
      modelId: activeModel,
      provider: "ollama",
      contextWindow: modelConfig.contextWindow,
      supportsStreaming: modelConfig.supportsStreaming,
      supportsTools: modelConfig.supportsTools,
      supportsVision: modelConfig.supportsVision,
      supportsReasoning: modelConfig.supportsReasoning,
    };
  }
}
