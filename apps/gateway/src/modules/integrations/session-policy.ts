import { IntegrationToolRisk } from "@shared/models";
import { SessionPolicyConfig } from "./composio.adapter";
import { canonicalizeArguments } from "./integrations.utils";
import {
  COMPOSIO_GET_TOOL_SCHEMAS,
  schemaRequestSlugs,
} from "./session-protocol";

export interface SessionPolicyConnection {
  toolkitSlug: string;
  connectedAccountId: string;
  composioUserId: string;
}

export interface SessionPolicyRecord {
  toolkitSlug: string;
  enabled: boolean;
  allowedTools: Array<{ slug: string; risk: IntegrationToolRisk }>;
}

export interface BuiltSessionPolicy {
  config: SessionPolicyConfig;
  hash: string;
  composioUserId: string;
  riskByTool: Map<string, IntegrationToolRisk>;
}

export function buildSessionPolicy(input: {
  composioUserId: string;
  connections: SessionPolicyConnection[];
  policies: SessionPolicyRecord[];
}): BuiltSessionPolicy | null {
  const policies = new Map(
    input.policies
      .filter((policy) => policy.enabled && policy.allowedTools.length > 0)
      .map((policy) => [policy.toolkitSlug, policy]),
  );
  const selected = new Map<string, SessionPolicyConnection>();
  for (const connection of input.connections) {
    if (
      connection.composioUserId !== input.composioUserId ||
      selected.has(connection.toolkitSlug) ||
      !policies.has(connection.toolkitSlug)
    ) {
      continue;
    }
    selected.set(connection.toolkitSlug, connection);
  }
  if (selected.size === 0) return null;

  const tools: SessionPolicyConfig["tools"] = {};
  const connectedAccounts: SessionPolicyConfig["connectedAccounts"] = {};
  const riskByTool = new Map<string, IntegrationToolRisk>();
  for (const [toolkitSlug, connection] of selected) {
    const policy = policies.get(toolkitSlug)!;
    const enable = policy.allowedTools.map((tool) => tool.slug).sort();
    const requireApproval = policy.allowedTools
      .filter((tool) => tool.risk === "sensitive")
      .map((tool) => tool.slug)
      .sort();
    tools[toolkitSlug] = {
      enable,
      ...(requireApproval.length > 0 ? { requireApproval } : {}),
    };
    connectedAccounts[toolkitSlug] = [connection.connectedAccountId];
    for (const tool of policy.allowedTools)
      riskByTool.set(tool.slug, tool.risk);
  }

  const toolkitSlugs = [...selected.keys()].sort();
  const config = { toolkitSlugs, tools, connectedAccounts };
  return {
    config,
    hash: canonicalizeArguments(config).hash,
    composioUserId: input.composioUserId,
    riskByTool,
  };
}

export function batchToolSlugs(args: Record<string, unknown>): string[] {
  const values = Array.isArray(args.tools) ? args.tools : [];
  const slugs: string[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const slug = record.toolSlug ?? record.tool_slug ?? record.slug;
    if (typeof slug === "string") slugs.push(slug);
  }
  return [...new Set(slugs)];
}

function symbolicTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const character of value) {
    const upper = character.toUpperCase();
    if (
      (upper >= "A" && upper <= "Z") ||
      (character >= "0" && character <= "9")
    ) {
      current += upper;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function isDependencyPlaceholder(value: string): boolean {
  const candidate = value.trim();
  if (
    (candidate.startsWith("<") && candidate.endsWith(">")) ||
    (candidate.startsWith("{{") && candidate.endsWith("}}"))
  ) {
    return true;
  }
  if (candidate !== candidate.toUpperCase()) return false;
  const tokens = symbolicTokens(candidate);
  if (tokens.length === 0) return false;
  if (["YOUR", "NEW", "INSERT", "PLACEHOLDER"].includes(tokens[0])) {
    return true;
  }
  if (tokens[0] === "REPLACE" && tokens[1] === "WITH") return true;
  const from = tokens.indexOf("FROM");
  return (
    from > 0 &&
    from < tokens.length - 1 &&
    tokens.slice(0, from).some((token) => token === "ID" || token === "URL")
  );
}

/** Multi-execute entries run in parallel, so a future output cannot be input. */
export function findDependencyPlaceholder(value: unknown): string | null {
  if (typeof value === "string") {
    const candidate = value.trim();
    return isDependencyPlaceholder(candidate) ? candidate : null;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const placeholder = findDependencyPlaceholder(child);
      if (placeholder) return placeholder;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      const placeholder = findDependencyPlaceholder(child);
      if (placeholder) return placeholder;
    }
  }
  return null;
}

export function classifyMetaExecution(input: {
  metaToolSlug: string;
  args: Record<string, unknown>;
  riskByTool: Map<string, IntegrationToolRisk>;
}): { allowed: boolean; mutating: boolean; toolSlugs: string[] } {
  const toolSlugs =
    input.metaToolSlug === COMPOSIO_GET_TOOL_SCHEMAS
      ? schemaRequestSlugs(input.args)
      : batchToolSlugs(input.args);
  const allowed = toolSlugs.every((slug) => input.riskByTool.has(slug));
  const readMeta =
    input.metaToolSlug === "COMPOSIO_SEARCH_TOOLS" ||
    input.metaToolSlug === "COMPOSIO_GET_TOOL_SCHEMAS";
  const mutating =
    !readMeta &&
    (toolSlugs.length === 0 ||
      toolSlugs.some((slug) => input.riskByTool.get(slug) !== "read"));
  return { allowed, mutating, toolSlugs };
}

/**
 * Builds an idempotency identity from the underlying mutations rather than
 * Composio's workflow bookkeeping fields (session_id/current_step). This
 * blocks semantically identical retries while allowing a corrected dependency
 * ID or other real argument change to proceed.
 */
export function mutationExecutionIdentity(
  args: Record<string, unknown>,
  riskByTool: Map<string, IntegrationToolRisk>,
): unknown {
  if (!Array.isArray(args.tools)) return args;
  return args.tools
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    )
    .map((entry) => {
      const toolSlug = entry.toolSlug ?? entry.tool_slug ?? entry.slug;
      return {
        toolSlug,
        arguments: entry.arguments ?? {},
        ...(entry.account !== undefined ? { account: entry.account } : {}),
      };
    })
    .filter(
      (entry) =>
        typeof entry.toolSlug === "string" &&
        riskByTool.get(entry.toolSlug) !== "read",
    );
}

/**
 * A failed parallel batch is safely retryable only when every mutating entry
 * is explicitly reported as unsuccessful. Any successful or unknown mutation
 * makes the overall outcome uncertain and therefore non-replayable.
 */
export function failedMutationOutcome(input: {
  data: unknown;
  toolSlugs: string[];
  riskByTool: Map<string, IntegrationToolRisk>;
}): "failed" | "uncertain" {
  const mutatingSlugs = input.toolSlugs.filter(
    (slug) => input.riskByTool.get(slug) !== "read",
  );
  if (mutatingSlugs.length === 0) return "failed";
  if (
    !input.data ||
    typeof input.data !== "object" ||
    Array.isArray(input.data)
  )
    return "uncertain";
  const results = (input.data as Record<string, unknown>).results;
  if (!Array.isArray(results)) return "uncertain";

  for (const slug of mutatingSlugs) {
    const entries = results.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return false;
      const record = entry as Record<string, unknown>;
      return (record.tool_slug ?? record.toolSlug ?? record.slug) === slug;
    });
    if (entries.length === 0) return "uncertain";
    for (const entry of entries) {
      const record = entry as Record<string, unknown>;
      const response =
        record.response &&
        typeof record.response === "object" &&
        !Array.isArray(record.response)
          ? (record.response as Record<string, unknown>)
          : undefined;
      if (response?.successful !== false) return "uncertain";
    }
  }
  return "failed";
}

export function canReuseSession(input: {
  status: string;
  policyHash: string;
  expectedPolicyHash: string;
  expiresAt: Date;
  now: Date;
}): boolean {
  return (
    input.status === "active" &&
    input.policyHash === input.expectedPolicyHash &&
    input.expiresAt > input.now
  );
}
