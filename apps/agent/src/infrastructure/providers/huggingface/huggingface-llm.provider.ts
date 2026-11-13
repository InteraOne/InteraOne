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
  cleanAssistantResponse,
  TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION,
} from "../utils/tool-limit";
import { buildToolInputSchema } from "../utils/tool-schema";
import {
  executeToolBatch,
  MAX_TOOL_LOOPS,
  toolOutcomeContent,
} from "../../../modules/agents/tool-loop";

export class HuggingFaceLLMProvider implements LLMProvider {
  readonly name = "huggingface";
  private client: InferenceClient;
  private defaultModel: string;
  private readonly callTimeoutMs = Math.max(
    1_000,
    Number(process.env.HF_MAX_TIMEOUT_MS || 60_000),
  );
  private readonly workflowTimeoutMs = Math.max(
    this.callTimeoutMs,
    Number(process.env.HF_WORKFLOW_TIMEOUT_MS || 180_000),
  );

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

    try {
      const result = await this.executeGenerate(
        messages,
        options,
        tokenTracker,
        Date.now() + this.workflowTimeoutMs,
      );

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
    workflowDeadline: number,
  ): Promise<LLMGenerateResult> {
    const {
      model = this.defaultModel,
      tools = [],
      toolContext,
      onStream,
      onToolEvent,
    } = options;

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
        const stream = this.client.chatCompletionStream(payload, {
          signal: this.requestSignal(workflowDeadline),
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

              // Preserve standalone spaces/newlines emitted as their own delta.
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
        const result = await this.client.chatCompletion(payload, {
          signal: this.requestSignal(workflowDeadline),
        });
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
        hfMessages.push({
          role: "tool",
          tool_call_id: outcome.call.id,
          name: outcome.call.name,
          content: toolOutcomeContent(outcome),
        });
        if (!outcome.deferred) steps.push(outcome.step);
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
      const finalStream = this.client.chatCompletionStream(finalPayload, {
        signal: this.requestSignal(workflowDeadline),
      });
      for await (const chunk of finalStream) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          responseText += content;
          if (tools.length === 0) onStream(content, false);
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
      const finalResult = await this.client.chatCompletion(finalPayload, {
        signal: this.requestSignal(workflowDeadline),
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

  private requestSignal(workflowDeadline: number): AbortSignal {
    const remainingMs = workflowDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Hugging Face workflow timed out after ${this.workflowTimeoutMs}ms`,
      );
    }
    return AbortSignal.timeout(Math.min(this.callTimeoutMs, remainingMs));
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
