import { describe, expect, it } from "vitest";
import { getToolsForContext } from "../src/modules/agents/tools";
import { getChannelConfig } from "../src/modules/chat/services/system-prompt/channels";

describe("Threads AI support", () => {
  it("uses a signed-in, plain-text support prompt", () => {
    const prompt = getChannelConfig("threads");
    expect(prompt.style).toContain("plain text");
    expect(prompt.idVerification).toContain("already signed in");
  });

  it("offers knowledge, conversation memory, and handoff for self-serve customers", async () => {
    const options = {
      channel: "threads" as const,
      organizationId: "org",
      conversationId: "thread",
    };
    const { tools, connectedIntent } = await getToolsForContext(options);
    expect(connectedIntent).toBe(false);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "conversation_memory",
      "escalate_to_human",
      "faq_retrieval",
      "knowledge_retrieval",
      "mark_query_resolved",
      "save_unanswered_question",
    ]);
    const withoutHandoff = await getToolsForContext({
      ...options,
      fallbackToAgent: false,
    });
    expect(
      withoutHandoff.tools.some((tool) => tool.name === "escalate_to_human"),
    ).toBe(false);
  });
});
