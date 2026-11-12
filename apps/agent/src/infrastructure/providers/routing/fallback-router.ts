import { ProviderFactory } from "../factory/provider.factory";
import {
  LLMGenerateResult,
  LLMMessage,
  LLMOptions,
} from "../types/ai.types";
import { getLLMModelConfig, LLM_REGISTRY, hasProviderCredentials } from "../registry/model.registry";
import config from "../../../config";
import logger from "../../../shared/logger";
import { modelHealth, ModelFailureType } from "./model-health";

export interface FallbackChainEntry {
  /** Provider name — e.g. "bedrock" */
  provider: string;
  /** Specific model to use for this entry. If omitted, the provider default is used. */
  model?: string;
}

const ACTIVE_PROVIDER = (process.env.LLM_PROVIDER ?? "bedrock") as "bedrock" | "ollama" | "huggingface" | "openai";

const DEFAULT_MODEL = ACTIVE_PROVIDER === "ollama"
  ? (config.llm.ollama?.model ?? "llama3.2")
  : ACTIVE_PROVIDER === "huggingface"
  ? (config.llm.huggingface?.model ?? "meta-llama/Llama-3.3-70B-Instruct")
  : ACTIVE_PROVIDER === "openai"
  ? (config.llm.openai?.model ?? "gpt-4o-mini")
  : (config.llm.bedrock?.model ?? "us.amazon.nova-pro-v1:0");

/**
 * Builds the fallback chain dynamically from the static registry.
 *
 * 1. The primary model (from DEFAULT_MODEL) is always first.
 * 2. Only models from providers with configured credentials/API keys are included.
 * 3. Only models with at least the primary's tool & vision capabilities are included.
 * 4. Models currently marked dead by the circuit breaker are skipped dynamically during execution.
 */
function buildFallbackChain(): FallbackChainEntry[] {
  const primaryConfig = getLLMModelConfig(DEFAULT_MODEL);

  const candidates: { modelId: string; priority: number; provider: string }[] = [];

  for (const [modelId, modelCfg] of Object.entries(LLM_REGISTRY)) {
    if (modelId === DEFAULT_MODEL) continue;

    // ── Rule 1: Must have credentials configured for the provider ────────────────
    if (!hasProviderCredentials(modelCfg.provider)) continue;

    // ── Rule 2: Must support at least the primary's tool & vision capabilities ───
    if (primaryConfig.supportsTools && !modelCfg.supportsTools) continue;
    if (primaryConfig.supportsVision && !modelCfg.supportsVision) continue;

    candidates.push({
      modelId,
      priority: modelCfg.fallbackPriority ?? 99,
      provider: modelCfg.provider,
    });
  }

  // Sort by priority (lower = tried earlier)
  candidates.sort((a, b) => a.priority - b.priority);

  const chain: FallbackChainEntry[] = [
    { provider: primaryConfig.provider, model: DEFAULT_MODEL },
    ...candidates.map((c) => ({ provider: c.provider, model: c.modelId })),
  ];

  logger.info("[FallbackRouter] Dynamic fallback chain built", {
    primary: DEFAULT_MODEL,
    chain: chain.map((e) => e.model ?? e.provider),
    deadModels: modelHealth.getDeadModels(),
  });

  return chain;
}

/**
 * Wraps LLM generation with an ordered fallback chain + circuit breaker.
 */
export class FallbackRouter {
  static async generate(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMGenerateResult> {
    // Build fallback chain dynamically on each request to respect active credentials
    const chain = buildFallbackChain();
    let lastError: Error | undefined;
    let attemptNumber = 0;

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      const modelId = entry.model ?? "(provider-default)";

      // ── Circuit breaker: skip dead models instantly ──────────────────────
      if (!modelHealth.isHealthy(modelId)) {
        logger.debug("[FallbackRouter] Skipping dead model", { modelId });
        continue;
      }

      attemptNumber += 1;
      const isFallback = i > 0;

      try {
        const provider = ProviderFactory.getLLMProvider(entry.provider);

        const opts: LLMOptions = entry.model
          ? { ...options, model: entry.model }
          : options;

        if (isFallback) {
          logger.warn("[FallbackRouter] Trying fallback model", {
            attempt: attemptNumber,
            provider: entry.provider,
            model: entry.model,
            previousError: lastError?.message,
          });
        }

        const result = await provider.generate(messages, opts);

        // Some providers do not support a native "required" tool choice. Enforce
        // the contract after generation so they cannot silently answer with a
        // guide or fabricated success instead of executing the connected tool.
        if (options.requireToolCall) {
          const connectedToolNames = new Set(
            (options.tools || [])
              .filter((tool) => tool.description.startsWith("[Connected "))
              .map((tool) => tool.name),
          );
          const executedConnectedTool = (result.steps || []).some((step) =>
            connectedToolNames.has(step.toolName),
          );
          if (!executedConnectedTool) {
            throw new Error(
              "Required connected tool was not executed by the language model",
            );
          }
        }

        // ── Success — clear any prior failure record ────────────────────────
        modelHealth.markHealthy(modelId);

        return result;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const errorMsg = lastError.message;

        // ── Classify the error and update circuit breaker ───────────────────
        const failureType = modelHealth.markFailed(modelId, errorMsg);

        const remainingHealthy = chain
          .slice(i + 1)
          .filter((e) => modelHealth.isHealthy(e.model ?? "(provider-default)"))
          .length;

        logger.error("[FallbackRouter] Model failed", {
          attempt: attemptNumber,
          provider: entry.provider,
          model: entry.model,
          failureType,
          error: errorMsg,
          healthyModelsLeft: remainingHealthy,
        });

        if (failureType === ModelFailureType.MODEL_DEPRECATED) {
          logger.warn("[FallbackRouter] Model deprecated — circuit open for 24h", {
            modelId: entry.model,
          });
        }
      }
    }

    throw lastError ?? new Error("[FallbackRouter] All models failed or dead");
  }
}
