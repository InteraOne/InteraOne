export const TOOL_LIMIT_FINAL_RESPONSE_INSTRUCTION = `
The tool-call limit has now been reached. Do not call, request, or emit any more
tools. Generate the final response to the client using only the conversation,
retrieved knowledge, RAG context, and tool results already available above.
Answer as helpfully and completely as the available information allows. If an
important detail is still unavailable, say so clearly without attempting
another tool call.
`.trim();

export function cleanFinalResponse(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<(thinking|thought)>[\s\S]*$/gi, "")
    .replace(/<\/?(?:thinking|thought)>/gi, "")
    .trim();
}

function protocolToken(value: string): string {
  let result = "";
  for (const character of value.toUpperCase()) {
    if (
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      '[]<>(){}:"'.includes(character)
    ) {
      result += character;
    }
  }
  return result;
}

/** Reject textual function syntax; tool-capable providers must use native calls. */
export function cleanAssistantResponse(
  text: string,
  toolNames: string[],
): string {
  const cleaned = cleanFinalResponse(text);
  if (!cleaned || toolNames.length === 0) return cleaned;
  const token = protocolToken(cleaned);
  const serialized =
    token.includes("<TOOLCALL>") ||
    toolNames.some((name) => token.includes(`${protocolToken(name)}(`));
  if (serialized) {
    throw new Error(
      "The language model emitted textual tool-call syntax instead of a native structured tool call",
    );
  }
  return cleaned;
}
