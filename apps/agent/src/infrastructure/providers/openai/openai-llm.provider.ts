import { OpenAI } from "openai";
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
  cleanAssistantResponse,
  TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION,
} from "../utils/tool-limit";
import { buildToolInputSchema } from "../utils/tool-schema";
import {
  executeToolBatch,
  MAX_TOOL_LOOPS,
  toolOutcomeContent,
} from "../../../modules/agents/tool-loop";

export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";
  private client?: OpenAI;
  private defaultModel: string;

  constructor() {
    const openaiConfig = config.llm.openai;
    this.defaultModel = openaiConfig?.model || "gpt-4o-mini";
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const openaiConfig = config.llm.openai;
      if (!openaiConfig || !openaiConfig.apiKey) {
        throw new Error("OpenAI configuration or API Key is missing");
      }
      this.client = new OpenAI({
        apiKey: openaiConfig.apiKey,
      });
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
      process.env.OPENAI_MAX_TIMEOUT_MS || "60000",
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
                  `OpenAI generation timed out after ${maxTimeoutMs}ms`,
                ),
              ),
            maxTimeoutMs,
          ),
        ),
      ]);

      const totalUsage = tokenTracker.toUsage();
      const latencyMs = latencyTracker.stopMs();
      const estimatedCost = estimateCost(
        "openai",
        model,
        totalUsage.promptTokens ?? 0,
        totalUsage.completionTokens ?? 0,
      );

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "openai",
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
      const estimatedCost = estimateCost(
        "openai",
        model,
        totalUsage.promptTokens ?? 0,
        totalUsage.completionTokens ?? 0,
      );

      trackAICall({
        timestamp: new Date().toISOString(),
        provider: "openai",
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

    const openaiTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: buildToolInputSchema(t),
            },
          }))
        : undefined;

    const openAIMessages: any[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const steps: LLMGenerateStep[] = [];
    let loop = 0;
    let responseText = "";

    while (loop < MAX_TOOL_LOOPS) {
      loop++;
      responseText = "";

      const payload: any = {
        model,
        messages: openAIMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      };
      if (openaiTools) {
        payload.tools = openaiTools;
        if (options.requireToolCall && loop === 1) {
          payload.tool_choice = "required";
        }
      }

      let toolCalls: Array<{
        id: string;
        function: { name: string; arguments: string };
      }> = [];

      if (onStream) {
        const stream = await client.chat.completions.create({
          model,
          messages: openAIMessages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens,
          tools: openaiTools,
          tool_choice:
            options.requireToolCall && loop === 1 ? "required" : undefined,
          stream: true,
        });

        for await (const chunk of stream) {
          if (chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            if (delta.content) {
              responseText += delta.content;

              let cleanText = delta.content
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
                .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
                .replace(/<\/?(?:thinking|thought)>/gi, "");

              // Whitespace-only deltas are meaningful boundaries between
              // tokens/paragraphs and must remain in the visible stream.
              if (tools.length === 0 && cleanText.length > 0) {
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

          if (chunk.usage) {
            tokenTracker.accumulate({
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            });
          }
        }

        // Estimation fallback
        if (
          tokenTracker.toUsage().totalTokens === undefined ||
          tokenTracker.toUsage().totalTokens === 0
        ) {
          const estimatedPrompt = Math.ceil(
            JSON.stringify(openAIMessages).length / 4,
          );
          const estimatedCompletion = Math.ceil(responseText.length / 4);
          tokenTracker.accumulate({
            promptTokens: estimatedPrompt,
            completionTokens: estimatedCompletion,
            totalTokens: estimatedPrompt + estimatedCompletion,
          });
        }
      } else {
        const result = await client.chat.completions.create(payload);
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
            JSON.stringify(openAIMessages).length / 4,
          );
          const estimatedCompletion = Math.ceil(responseText.length / 4);
          tokenTracker.accumulate({
            promptTokens: estimatedPrompt,
            completionTokens: estimatedCompletion,
            totalTokens: estimatedPrompt + estimatedCompletion,
          });
        }
      }

      // Filter empty tool slots
      toolCalls = toolCalls.filter(Boolean);

      if (toolCalls.length === 0) {
        const cleanText = cleanAssistantResponse(
          responseText,
          tools.map((tool) => tool.name),
        );
        if (onStream && tools.length > 0 && cleanText) {
          onStream(cleanText, false);
        }

        return {
          text: cleanText || "Sorry, I could not generate a response.",
          usage: tokenTracker.toUsage(),
          steps,
        };
      }

      // Push assistant tool call back into context
      openAIMessages.push({
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

      const outcomes = await executeToolBatch({
        calls: toolCalls.map((call) => ({
          id: call.id,
          name: call.function.name,
          input: call.function.arguments,
        })),
        tools,
        context: toolContext,
        onToolEvent,
      });
      for (const outcome of outcomes) {
        if (!outcome.deferred) options.onToolStep?.(outcome.step);
        openAIMessages.push({
          role: "tool",
          tool_call_id: outcome.call.id,
          name: outcome.call.name,
          content: toolOutcomeContent(outcome),
        });
        if (!outcome.deferred) steps.push(outcome.step);
      }
    }

    const systemMessage = openAIMessages.find(
      (message) => message.role === "system",
    );
    if (systemMessage) {
      systemMessage.content = `${systemMessage.content}\n\n${TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION}`;
    } else {
      openAIMessages.unshift({
        role: "system",
        content: TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION,
      });
    }

    responseText = "";
    if (onStream) {
      const finalStream = await client.chat.completions.create({
        model,
        messages: openAIMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        stream: true,
      });

      for await (const chunk of finalStream) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          responseText += content;
          if (tools.length === 0) onStream(content, false);
        }
        if (chunk.usage) {
          tokenTracker.accumulate({
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          });
        }
      }
    } else {
      const finalResult = await client.chat.completions.create({
        model,
        messages: openAIMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      });
      responseText = finalResult.choices[0]?.message?.content || "";
      if (finalResult.usage) {
        tokenTracker.accumulate({
          promptTokens: finalResult.usage.prompt_tokens,
          completionTokens: finalResult.usage.completion_tokens,
          totalTokens: finalResult.usage.total_tokens,
        });
      }
    }

    const finalCleanText = cleanAssistantResponse(
      responseText,
      tools.map((tool) => tool.name),
    );
    if (onStream && tools.length > 0 && finalCleanText) {
      onStream(finalCleanText, false);
    }

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
      provider: "openai",
      contextWindow: modelConfig.contextWindow,
      supportsStreaming: modelConfig.supportsStreaming,
      supportsTools: modelConfig.supportsTools,
      supportsVision: modelConfig.supportsVision,
      supportsReasoning: modelConfig.supportsReasoning,
    };
  }
}
