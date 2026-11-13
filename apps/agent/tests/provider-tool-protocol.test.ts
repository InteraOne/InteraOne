import { describe, expect, it } from "vitest";
import { cleanAssistantResponse } from "../src/infrastructure/providers/utils/tool-limit";

describe("provider-neutral native tool protocol", () => {
  const tools = [
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
  ];

  it.each([
    [
      "OpenAI-compatible textual call",
      '[COMPOSIO_MULTI_EXECUTE_TOOL(tools=[{"tool_slug":"APP_CREATE"}])]',
    ],
    [
      "Hugging Face XML fallback",
      '<tool_call>{"name":"COMPOSIO_SEARCH_TOOLS","arguments":{}}</tool_call>',
    ],
    [
      "Ollama-style function text",
      'COMPOSIO_GET_TOOL_SCHEMAS({"tool_slugs":["APP_CREATE"]})',
    ],
  ])("rejects %s instead of exposing it in chat", (_provider, output) => {
    expect(() => cleanAssistantResponse(output, tools)).toThrow(
      "native structured tool call",
    );
  });

  it("keeps normal user-facing responses", () => {
    expect(
      cleanAssistantResponse(
        "The folder was created and verified successfully.",
        tools,
      ),
    ).toBe("The folder was created and verified successfully.");
  });
});
