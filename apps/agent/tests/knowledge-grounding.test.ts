import { describe, expect, it } from "vitest";
import {
  broaderKnowledgeQuery,
  containsFabricatedPlaceholder,
  shouldGroundKnowledgeRequest,
  verifiedEvidence,
} from "../src/modules/chat/pipelines/knowledge-grounding";

describe("knowledge grounding", () => {
  it("requires evidence for unknown entity and institution questions", () => {
    expect(shouldGroundKnowledgeRequest("tell me about nmiet collage")).toBe(
      true,
    );
    expect(shouldGroundKnowledgeRequest("What is Acme's refund policy?")).toBe(
      true,
    );
    expect(shouldGroundKnowledgeRequest("hello")).toBe(false);
  });

  it("retries with a conservative entity query", () => {
    expect(broaderKnowledgeQuery("Tell me about NMIET?")).toBe("NMIET");
  });

  it("accepts only successful, non-empty evidence and removes duplicates", () => {
    expect(verifiedEvidence({ status: "no_results", results: [] })).toEqual([]);
    expect(
      verifiedEvidence({
        status: "ok",
        results: [
          { content: "Nutan Maharashtra Institute" },
          { content: "Nutan Maharashtra Institute" },
          { content: "" },
        ],
      }),
    ).toEqual([{ content: "Nutan Maharashtra Institute" }]);
  });

  it("blocks the placeholder pattern visible in the hallucinated answer", () => {
    expect(
      containsFabricatedPlaceholder("Located in [City, State, India]"),
    ).toBe(true);
    expect(containsFabricatedPlaceholder("Located in Pune, Maharashtra")).toBe(
      false,
    );
  });
});
