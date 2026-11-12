export const KNOWLEDGE_GAP_RESPONSE =
  "I don't have verified information about that in the available knowledge base, so I won't guess.";

const FACTUAL_LOOKUP = [
  /\b(?:tell|teach)\s+me\s+about\b/i,
  /\b(?:what|who|where)\s+(?:is|are|was|were)\b/i,
  /\b(?:information|details|overview|background)\s+(?:about|on|of)\b/i,
  /\b(?:college|institute|company|organization|product|service|policy|admission|course|pricing)\b/i,
];

export function shouldGroundKnowledgeRequest(query: string): boolean {
  const normalized = query.trim().replace(/\s+/g, " ");
  return (
    !!normalized && FACTUAL_LOOKUP.some((pattern) => pattern.test(normalized))
  );
}

export function broaderKnowledgeQuery(query: string): string {
  return query
    .trim()
    .replace(/^(?:please\s+)?(?:tell|teach)\s+me\s+about\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

export function verifiedEvidence(result: unknown): Array<{
  content: string;
  source?: string;
  score?: number;
}> {
  if (!result || typeof result !== "object") return [];
  const record = result as {
    status?: string;
    results?: Array<{ content?: string; source?: string; score?: number }>;
  };
  if (record.status !== "ok" || !Array.isArray(record.results)) return [];

  const seen = new Set<string>();
  return record.results.flatMap((item) => {
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content || seen.has(content)) return [];
    seen.add(content);
    return [{ content, source: item.source, score: item.score }];
  });
}

export function containsFabricatedPlaceholder(answer: string): boolean {
  return /\[(?:city|state|country|year|university|accreditation body|official website|email|phone)[^\]]*\]/i.test(
    answer,
  );
}
