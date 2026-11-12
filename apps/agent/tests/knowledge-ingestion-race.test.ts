import { describe, expect, it } from "vitest";
import { isDeletedKnowledgeError } from "../src/workers/knowledge-ingestion.worker";

describe("knowledge ingestion deletion race", () => {
  it("recognizes deleted-source failures from supported error shapes", () => {
    expect(isDeletedKnowledgeError({ response: { status: 404 } })).toBe(true);
    expect(isDeletedKnowledgeError({ statusCode: 404 })).toBe(true);
    expect(
      isDeletedKnowledgeError(new Error("Request failed with status code 404")),
    ).toBe(true);
  });

  it("does not hide unrelated ingestion failures", () => {
    expect(isDeletedKnowledgeError({ response: { status: 401 } })).toBe(false);
    expect(
      isDeletedKnowledgeError(new Error("embedding provider timeout")),
    ).toBe(false);
  });
});
