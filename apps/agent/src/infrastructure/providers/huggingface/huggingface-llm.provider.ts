import { InferenceClient } from "@huggingface/inference";
import { LLMProvider } from "../base/llm.provider";
import {
  LLMGenerateResult,
  LLMMessage,
  LLMOptions,
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

export class HuggingFaceLLMProvider implements LLMProvider {
  readonly name = "huggingface";
  private client: InferenceClient;
  private defaultModel: string;

  constructor() {
    const hfConfig = config.llm.huggingface;
    const token = hfConfig?.token || "";
    this.defaultModel = hfConfig?.model || "meta-llama/Llama-3.3-70B-Instruct";
    this.client = new InferenceClient(token, {
      endpointUrl: hfConfig?.endpointUrl || undefined,
    });
  }

  async generate(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMGenerateResult> {
    const latencyTracker = new LatencyTracker();
    latencyTracker.start();
    const tokenTracker = new TokenTracker();
    const model = options.model ?? this.defaultModel;
    const maxTimeoutMs = parseInt(process.env.HF_MAX_TIMEOUT_MS || "60000", 10);

    try {
      const result = await Promise.race([
        this.executeGenerate(messages, options, tokenTracker),
        new Promise<LLMGenerateResult>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Hugging Face generation timed out after ${maxTimeoutMs}ms`,
                ),
              ),
            maxTimeoutMs,
          ),
        ),
      ]);

      const totalUsage = tokenTracker.toUsage();
      const latencyMs = latencyTracker.stopMs();
      const estimatedCost = estimateCost("huggingface", model, 0, 0);

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "huggingface",
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
        provider: "huggingface",
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

    const hfTools =
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

    const hfMessages: any[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const MAX_TOOL_LOOPS = 5;
    const steps: LLMGenerateStep[] = [];
    let loop = 0;
    let responseText = "";

    while (loop < MAX_TOOL_LOOPS) {
      loop++;
      responseText = "";

      const payload: any = {
        model,
        messages: hfMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      };
      if (hfTools) {
        payload.tools = hfTools;
        if (options.requireToolCall && loop === 1) {
          payload.tool_choice = "required";
        }
      }

      let toolCalls: Array<{
        id: string;
        function: { name: string; arguments: string };
      }> = [];

      if (onStream) {
        const stream = this.client.chatCompletionStream(payload);

        for await (const chunk of stream) {
          if (chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            if (delta.content) {
              responseText += delta.content;

              let cleanText = delta.content
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
                .replace(/<\/?(?:thinking|thought)>/gi, "");

              // Preserve standalone spaces/newlines emitted as their own delta.
              if (cleanText.length > 0) {
                onStream(cleanText, false);
              }
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!toolCalls[index]) {
                  toolCalls[index] = {
                    id: tc.id || `call_${Date.now()}_${index}`,
                    function: { name: "", arguments: "" },
                  };
                }
                if (tc.function?.name) {
                  toolCalls[index].function.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCalls[index].function.arguments += tc.function.arguments;
                }
              }
            }
          }

          // Accumulate approximate token usage for streaming
          // Since HF chatCompletionStream doesn't consistently return usage metadata in all models,
          // we estimate based on characters if no usage is returned.
          const usage = (chunk as any).usage;
          if (usage) {
            tokenTracker.accumulate({
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            });
          }
        }

        // If no usage was reported in the stream, perform fallback token estimation
        if (
          tokenTracker.toUsage().totalTokens === undefined ||
          tokenTracker.toUsage().totalTokens === 0
        ) {
          const estimatedPrompt = Math.ceil(
            JSON.stringify(hfMessages).length / 4,
          );
          const estimatedCompletion = Math.ceil(responseText.length / 4);
          tokenTracker.accumulate({
            promptTokens: estimatedPrompt,
            completionTokens: estimatedCompletion,
            totalTokens: estimatedPrompt + estimatedCompletion,
          });
        }
      } else {
        const result = await this.client.chatCompletion(payload);
        responseText = result.choices[0]?.message?.content || "";

        if (result.choices[0]?.message?.tool_calls) {
          for (const tc of result.choices[0].message.tool_calls) {
            toolCalls.push({
              id: tc.id || `call_${Date.now()}`,
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "{}",
              },
            });
          }
        }

        const usage = result.usage;
        if (usage) {
          tokenTracker.accumulate({
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          });
        } else {
          const estimatedPrompt = Math.ceil(
            JSON.stringify(hfMessages).length / 4,
          );
          const estimatedCompletion = Math.ceil(responseText.length / 4);
          tokenTracker.accumulate({
            promptTokens: estimatedPrompt,
            completionTokens: estimatedCompletion,
            totalTokens: estimatedPrompt + estimatedCompletion,
          });
        }
      }

      // Filter out any empty slots in toolCalls
      toolCalls = toolCalls.filter(Boolean);

      if (toolCalls.length === 0) {
        // Fallback: Parse XML/custom tags generated directly in responseText by models that don't use structured tool calls natively
        // Patterns:
        // 1. <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>
        // 2. <toolname>{"arg": "val"}</toolname>
        const toolCallRegex =
          /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi;
        let match;
        while ((match = toolCallRegex.exec(responseText)) !== null) {
          try {
            const parsed = JSON.parse(match[1].trim());
            const name = parsed.name || parsed.call;
            const args = parsed.arguments || parsed.parameters || parsed;
            if (name) {
              toolCalls.push({
                id: `call_${Date.now()}_${toolCalls.length}`,
                function: {
                  name,
                  arguments:
                    typeof args === "string" ? args : JSON.stringify(args),
                },
              });
            }
          } catch {}
        }

        // If no tool_call tags, let's search for tags matching registered tool names
        if (toolCalls.length === 0) {
          for (const t of tools) {
            // Check both standard name and name without underscores (e.g. faq_retrieval and faqretrieval)
            const cleanNames = [t.name, t.name.replace(/_/g, "")];
            for (const name of cleanNames) {
              const customTagRegex = new RegExp(
                `<${name}>\\s*([\\s\\S]*?)\\s*(?:</${name}>|$)`,
                "gi",
              );
              let customMatch;
              while (
                (customMatch = customTagRegex.exec(responseText)) !== null
              ) {
                try {
                  const argsText = customMatch[1].trim();
                  JSON.parse(argsText); // Ensure it's valid JSON
                  toolCalls.push({
                    id: `call_${Date.now()}_${toolCalls.length}`,
                    function: { name: t.name, arguments: argsText },
                  });
                } catch {}
              }
            }
          }
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

      // Push assistant tool invocation back into messages
      hfMessages.push({
        role: "assistant",
        content: responseText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      const executeSingleToolCall = async (
        call: (typeof toolCalls)[number],
      ) => {
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
          if (
            !parsedInput ||
            typeof parsedInput !== "object" ||
            Array.isArray(parsedInput)
          ) {
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

          hfMessages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
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

          hfMessages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
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
      const sequentialTools = [
        "create_ticket",
        "update_ticket",
        "close_ticket",
        "send_email",
        "escalate_to_human",
      ];
      const isSequential = (name: string) =>
        sequentialTools.includes(name) ||
        tools.find((tool) => tool.name === name)?.executionMode === "sequential";
      const parallelCalls = toolCalls.filter(
        (c) => !isSequential(c.function.name),
      );
      const sequentialCalls = toolCalls.filter((c) =>
        isSequential(c.function.name),
      );

      // 1. Run parallel read/retrieval tools concurrently
      if (parallelCalls.length > 0) {
        await Promise.all(
          parallelCalls.map((call) => executeSingleToolCall(call)),
        );
      }

      // 2. Run sequential write/mutation tools
      for (const call of sequentialCalls) {
        await executeSingleToolCall(call);
      }
    }

    const systemMessage = hfMessages.find(
      (message) => message.role === "system",
    );
    if (systemMessage) {
      systemMessage.content = `${systemMessage.content}\n\n${TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION}`;
    } else {
      hfMessages.unshift({
        role: "system",
        content: TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION,
      });
    }

    responseText = "";
    const finalPayload = {
      model,
      messages: hfMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    };

    if (onStream) {
      const finalStream = this.client.chatCompletionStream(finalPayload);
      for await (const chunk of finalStream) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          responseText += content;
          onStream(content, false);
        }
        const usage = (chunk as any).usage;
        if (usage) {
          tokenTracker.accumulate({
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          });
        }
      }
    } else {
      const finalResult = await this.client.chatCompletion(finalPayload);
      responseText = finalResult.choices[0]?.message?.content || "";
      if (finalResult.usage) {
        tokenTracker.accumulate({
          promptTokens: finalResult.usage.prompt_tokens,
          completionTokens: finalResult.usage.completion_tokens,
          totalTokens: finalResult.usage.total_tokens,
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
      provider: "huggingface",
      contextWindow: modelConfig.contextWindow,
      supportsStreaming: modelConfig.supportsStreaming,
      supportsTools: modelConfig.supportsTools,
      supportsVision: modelConfig.supportsVision,
      supportsReasoning: modelConfig.supportsReasoning,
    };
  }
}
