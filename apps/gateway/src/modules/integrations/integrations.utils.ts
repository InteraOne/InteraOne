import { createHash } from "crypto";

const MAX_ARGUMENT_BYTES = 16_384;
const MAX_RESULT_BYTES = 32_768;
const ACTIONABLE_KEY =
  /(^|_)(id|ids|name|title|subject|label|url|uri|link|cursor|token|status|type)($|_)/i;

function canonicalizeValue(value: unknown, depth = 0): unknown {
  if (depth > 10)
    throw new Error("Integration arguments are too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Integration arguments contain an invalid number");
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => canonicalizeValue(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        continue;
      result[key] = canonicalizeValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    return result;
  }
  throw new Error("Integration arguments must be JSON-compatible");
}

export function canonicalizeArguments(input: unknown): {
  arguments: Record<string, unknown>;
  serialized: string;
  hash: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Integration arguments must be an object");
  }
  const args = canonicalizeValue(input) as Record<string, unknown>;
  const serialized = JSON.stringify(args);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARGUMENT_BYTES) {
    throw new Error("Integration arguments exceed the 16 KB limit");
  }
  return {
    arguments: args,
    serialized,
    hash: createHash("sha256").update(serialized).digest("hex"),
  };
}

export function boundedResult(value: unknown): unknown {
  const serialized = JSON.stringify(value ?? null);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_RESULT_BYTES) return value;

  const compact = (input: unknown, depth = 0): unknown => {
    // Provider responses such as Notion nest actionable page IDs and URLs
    // several levels below the result envelope. Keep them available to the
    // model; array and field limits still bound the final payload.
    if (depth > 10) return "[nested value omitted]";
    if (
      input === null ||
      typeof input === "number" ||
      typeof input === "boolean"
    )
      return input;
    if (typeof input === "string")
      return input.length > 1_000 ? `${input.slice(0, 1_000)}…` : input;
    if (Array.isArray(input)) {
      const kept = input.slice(0, 20).map((item) => compact(item, depth + 1));
      if (input.length > kept.length) {
        kept.push({ omittedItems: input.length - kept.length });
      }
      return kept;
    }
    if (typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>).sort(
        ([left], [right]) =>
          Number(ACTIONABLE_KEY.test(right)) -
          Number(ACTIONABLE_KEY.test(left)),
      );
      const result: Record<string, unknown> = {};
      for (const [key, child] of entries.slice(0, 50)) {
        result[key] = compact(child, depth + 1);
      }
      if (entries.length > 50) result.omittedFields = entries.length - 50;
      return result;
    }
    return String(input);
  };

  const compacted = compact(value);
  const compactedResult = {
    truncated: true,
    originalBytes: Buffer.byteLength(serialized, "utf8"),
    data: compacted,
  };
  if (
    Buffer.byteLength(JSON.stringify(compactedResult), "utf8") <=
    MAX_RESULT_BYTES
  ) {
    return compactedResult;
  }

  const actionableFields: Array<{ path: string; value: unknown }> = [];
  const collectActionableFields = (
    input: unknown,
    path: string,
    depth = 0,
  ): void => {
    if (depth > 10 || actionableFields.length >= 240 || !input) return;
    if (Array.isArray(input)) {
      input.forEach((item, index) =>
        collectActionableFields(item, `${path}/${index}`, depth + 1),
      );
      return;
    }
    if (typeof input !== "object") return;
    for (const [key, child] of Object.entries(
      input as Record<string, unknown>,
    )) {
      const childPath = `${path}/${key}`;
      if (
        ACTIONABLE_KEY.test(key) &&
        (typeof child === "string" || typeof child === "number")
      ) {
        actionableFields.push({
          path: childPath,
          value:
            typeof child === "string" && child.length > 500
              ? `${child.slice(0, 500)}…`
              : child,
        });
      }
      collectActionableFields(child, childPath, depth + 1);
      if (actionableFields.length >= 240) return;
    }
  };
  collectActionableFields(value, "");
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(serialized, "utf8"),
    message:
      "Result was compacted; use pagination or a narrower query for full records.",
    actionableFields,
  };
}

type ComposioExecuteResult = {
  data?: unknown;
  error?: string | null;
  resultType: string;
};

/**
 * Prefer the per-tool provider error returned by multi-execute over summaries
 * such as "1 out of 1 tools failed". The full structured result is still
 * returned separately to the agent.
 */
export function composioExecutionError(
  result: ComposioExecuteResult,
): string | undefined {
  if (result.resultType === "completed") return undefined;
  const data =
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : undefined;
  const entries = Array.isArray(data?.results) ? data.results : [];
  const details: string[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const response =
      record.response &&
      typeof record.response === "object" &&
      !Array.isArray(record.response)
        ? (record.response as Record<string, unknown>)
        : undefined;
    if (response?.successful === true) continue;
    const responseData =
      response?.data &&
      typeof response.data === "object" &&
      !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>)
        : undefined;
    const message = [record.error, response?.error, responseData?.message].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    if (!message) continue;
    const slug = [record.tool_slug, record.toolSlug, record.slug].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const detail = `${slug ? `${slug}: ` : ""}${message.replace(/\s+/g, " ").trim()}`;
    if (!details.includes(detail)) details.push(detail);
  }

  if (details.length > 0) return details.join("; ").slice(0, 2_000);
  return (
    result.error?.trim() || "Composio reported that the tool execution failed"
  );
}

export function safeIntegrationError(error: unknown): string {
  let current: unknown = error;
  let message = "Integration provider request failed";
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    const status = Number(candidate.status ?? candidate.statusCode);
    const candidateMessage =
      typeof candidate.message === "string" ? candidate.message : "";
    const code = typeof candidate.code === "string" ? candidate.code : "";

    if (
      status === 401 ||
      /APIKey_InvalidAPIKey|invalid api key|authenticationerror/i.test(
        `${code} ${candidateMessage}`,
      )
    ) {
      return "The Composio project API key is invalid. Create or copy a project API key from Composio Platform settings, update COMPOSIO_API_KEY, and restart the gateway.";
    }
    if (status === 403) {
      return "The Composio API key does not have permission to manage sessions or connected accounts.";
    }
    if (status === 429) {
      return "Composio is rate limiting requests. Please wait a moment and try again.";
    }
    if (/abort|timed? ?out/i.test(`${code} ${candidateMessage}`)) {
      return "The integration provider request timed out. Please try again.";
    }
    if (candidateMessage) message = candidateMessage;
    current = candidate.cause;
  }
  if (/api[_ -]?key|token|secret|credential|authorization/i.test(message)) {
    return "The integration provider rejected the request. Reconnect the account or contact an administrator.";
  }
  return message.slice(0, 500);
}
