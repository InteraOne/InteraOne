import { beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.fn();

vi.mock("../src/infrastructure/providers/factory/provider.factory", () => ({
  ProviderFactory: {
    getLLMProvider: () => ({ generate }),
  },
}));

vi.mock("../src/infrastructure/providers/registry/model.registry", () => ({
  getLLMModelConfig: (model: string) => ({
    provider: model === "fallback-model" ? "openai" : "huggingface",
    supportsTools: true,
    supportsVision: false,
  }),
  LLM_REGISTRY: {
    "fallback-model": {
      provider: "openai",
      supportsTools: true,
      supportsVision: false,
      fallbackPriority: 1,
    },
  },
  hasProviderCredentials: () => true,
}));

vi.mock("../src/config", () => ({
  default: {
    llm: {
      huggingface: { model: "primary-model" },
      openai: { model: "fallback-model" },
    },
  },
}));

describe("fallback safety after tool execution", () => {
  beforeEach(() => {
    generate.mockReset();
    vi.stubEnv("LLM_PROVIDER", "huggingface");
    vi.resetModules();
  });

  it("preserves completed steps and does not replay through another model", async () => {
    generate.mockImplementationOnce(async (_messages, options) => {
      options.onToolStep?.({
        toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: {},
        result: { status: "failed", error: "invalid parent" },
        error: "invalid parent",
        timestamp: new Date(),
      });
      throw new Error("provider timed out after tool execution");
    });

    const { FallbackRouter } =
      await import("../src/infrastructure/providers/routing/fallback-router");
    const result = await FallbackRouter.generate(
      [{ role: "user", content: "Create a page" }],
      {
        tools: [
          {
            name: "COMPOSIO_MULTI_EXECUTE_TOOL",
            description: "Execute connected tools",
            parameters: {},
            source: "composio",
            execute: vi.fn(),
          },
        ],
      },
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.steps).toHaveLength(1);
    expect(result.text).toContain(
      "won't report the requested action as complete",
    );
  });
});
