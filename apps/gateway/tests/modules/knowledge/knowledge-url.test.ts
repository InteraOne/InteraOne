import { describe, expect, it } from "vitest";
import { normalizeKnowledgeUrl } from "../../../src/modules/knowledge/knowledge-url";

describe("knowledge URL normalization", () => {
  it("collapses equivalent source URLs", () => {
    expect(normalizeKnowledgeUrl("https://www.NMIET.edu.in/")).toBe(
      normalizeKnowledgeUrl("https://nmiet.edu.in"),
    );
    expect(normalizeKnowledgeUrl("https://nmiet.edu.in/path/")).toBe(
      normalizeKnowledgeUrl("https://nmiet.edu.in/path"),
    );
  });

  it("preserves distinct paths and canonicalizes query ordering", () => {
    expect(normalizeKnowledgeUrl("https://example.com/a")).not.toBe(
      normalizeKnowledgeUrl("https://example.com/b"),
    );
    expect(normalizeKnowledgeUrl("https://example.com/?b=2&a=1")).toBe(
      normalizeKnowledgeUrl("https://example.com/?a=1&b=2"),
    );
  });
});
