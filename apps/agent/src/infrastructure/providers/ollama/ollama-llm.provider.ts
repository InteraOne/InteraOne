import axios from "axios";
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
                if (tools.length === 0 && cleanText.length > 0) {
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
        ollamaMessages.push({
          role: "tool",
          content: toolOutcomeContent(outcome),
        });
        if (!outcome.deferred) steps.push(outcome.step);
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
              if (tools.length === 0) {
                onStream(data.message.content, false);
              }
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
      provider: "ollama",
      contextWindow: modelConfig.contextWindow,
      supportsStreaming: modelConfig.supportsStreaming,
      supportsTools: modelConfig.supportsTools,
      supportsVision: modelConfig.supportsVision,
      supportsReasoning: modelConfig.supportsReasoning,
    };
  }
}
