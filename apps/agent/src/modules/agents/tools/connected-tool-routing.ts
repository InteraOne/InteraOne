import { Tool } from "../agent.types";

const CONNECTED_TOOL_PREFIX = "[Connected ";

const DIRECT_ACTION =
  /\b(?:list|find|search|fetch|get|read|show|check|count|retrieve|lookup|inspect|download|create|make|add|upload|send|post|schedule|update|edit|write|delete|remove|move|rename|share|invite|archive|assign|publish)\b/i;

const INSTRUCTION_REQUEST =
  /\b(?:how\s+(?:do|can|should|would)\s+(?:i|we)|show\s+me\s+how|steps?\s+(?:to|for)|guide\s+(?:me\s+)?(?:to|through)|instructions?\s+(?:to|for))\b/i;

const DIRECT_REQUEST =
  /(?:^(?:please\s+)?(?:list|find|search|fetch|get|read|show|check|count|retrieve|lookup|inspect|download|create|make|add|upload|send|post|schedule|update|edit|write|delete|remove|move|rename|share|invite|archive|assign|publish)\b|\b(?:can|could|would|will)\s+you\b|\b(?:i\s+(?:want|need)\s+you\s+to|go\s+ahead\s+and)\b)/i;

const EXPLICIT_EXECUTION_REQUEST =
  /(?:^please\s+[a-z][\w-]*\b|\b(?:can|could|would|will)\s+you\s+[a-z][\w-]*\b|\bi\s+(?:want|need)\s+you\s+to\s+[a-z][\w-]*\b|\bgo\s+ahead\s+and\s+[a-z][\w-]*\b)/i;

const INFORMATIONAL_REQUEST =
  /(?:^please\s+|\b(?:can|could|would|will)\s+you\s+|\bi\s+(?:want|need)\s+you\s+to\s+|\bgo\s+ahead\s+and\s+)(?:tell|explain|describe|summarize|teach|help|answer|compare)\b/i;

export function isConnectedTool(tool: Tool): boolean {
  return tool.description.startsWith(CONNECTED_TOOL_PREFIX);
}

function schemaHasFileUploadable(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(schemaHasFileUploadable);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.file_uploadable === true) return true;
  return Object.values(record).some(schemaHasFileUploadable);
}

/** True for an explicit execution request, including read-only operations. */
export function isDirectToolExecutionRequest(query: string): boolean {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized || INSTRUCTION_REQUEST.test(normalized)) return false;
  if (
    EXPLICIT_EXECUTION_REQUEST.test(normalized) &&
    !INFORMATIONAL_REQUEST.test(normalized)
  ) {
    return true;
  }
  return DIRECT_ACTION.test(normalized) && DIRECT_REQUEST.test(normalized);
}

/**
 * Connected-tool discovery is query-relevant, but the model should only be
 * forced to execute for an explicit command. Informational "how do I" queries
 * remain ordinary questions even when a related connected tool is available.
 */
export function shouldRequireConnectedToolCall(
  query: string,
  tools: Tool[],
): boolean {
  if (!tools.some(isConnectedTool)) return false;

  // A local/device file is user-owned input, not something the model can
  // synthesize. Do not force a tool call before a genuine attachment or a
  // current-session download result exists; the execution instructions tell
  // the model to request that input while still resolving discoverable IDs.
  if (
    /\b(?:upload|attach)\b/i.test(query) &&
    tools.some(
      (tool) =>
        isConnectedTool(tool) && schemaHasFileUploadable(tool.inputSchema),
    )
  ) {
    return false;
  }

  return isDirectToolExecutionRequest(query);
}

export function connectedToolExecutionInstruction(): string {
  return `

<connected_app_execution>
Live connected-app tools are available for this request. They are real execution capabilities, not documentation.
- When the visitor directly asks you to perform a matching action, call the connected-app tool before replying.
- Never replace an available tool call with a tutorial, manual steps, or a claim that you lack direct access.
- Before asking for a missing ID, folder, channel, user, page, record, or other discoverable value, use the available authorized read/search tools to resolve it. Continue the workflow with the returned value.
- Ask only for input that cannot be discovered through the connected tools. A local/device file must come from a real attachment in this conversation or a file returned by a tool in this execution; never invent a filename, path, URL, or storage key.
- Never copy schema examples, defaults, placeholder values, resource IDs, or URLs into a tool call. They are documentation, not live data.
- Treat every successful write as authoritative. Do not repeat a successful create, send, upload, delete, update, or other mutation, even to verify it or after changing models. Verify with an authorized read tool when verification is necessary.
- If a successful create call already included the requested body, content, text, or attachment, the create-and-populate workflow is complete. Do not call a second insert/update tool for the same content.
- If a tool returns a recoverable tool-selection or parameter error, inspect the available schemas, choose the correct capability or correct the arguments, and retry once before replying. Never expose raw provider JSON to the visitor.
- If genuinely non-discoverable required input is missing, ask only for that input. If execution fails, report the failure concisely; do not provide a how-to guide unless the visitor asks for one.
- Claim completion only when the tool result confirms completion.
</connected_app_execution>`;
}

/** Preserve the real provider reason without dumping nested JSON into chat. */
export function formatConnectedToolError(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (
        (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
        trimmed.length
      ) {
        try {
          current = JSON.parse(trimmed);
          continue;
        } catch {
          return trimmed.replace(/\s+/g, " ").slice(0, 400);
        }
      }
      return trimmed.replace(/\s+/g, " ").slice(0, 400);
    }
    if (current && typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.error !== undefined) {
        current = record.error;
        continue;
      }
      if (typeof record.message === "string") {
        current = record.message;
        continue;
      }
    }
    break;
  }
  return "The connected service rejected the request after one automatic retry";
}
