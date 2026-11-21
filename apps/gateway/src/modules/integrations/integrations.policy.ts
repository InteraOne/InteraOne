import { IntegrationToolRisk } from "@shared/models";
import { SessionPolicyConfig } from "./composio.adapter";
import { canonicalizeArguments } from "./integrations.utils";

export interface CatalogTool {
  slug: string;
  name: string;
  risk: IntegrationToolRisk;
  description: string;
  defaultEnabled: boolean;
  requiresApproval: boolean;
}

export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  category?: string;
  toolsCount?: number;
  tools: CatalogTool[];
}

/**
 * Composio's behavioral hints are the policy source of truth. Unknown or
 * incomplete metadata fails closed as a write instead of guessing from names.
 */
export function riskFromComposioTags(tags: string[]): IntegrationToolRisk {
  const normalized = new Set(tags.map((tag) => tag.toLowerCase()));
  if (normalized.has("destructivehint")) return "sensitive";
  if (normalized.has("readonlyhint")) return "read";
  return "write";
}

export function catalogToolFromComposio(input: {
  slug: string;
  name: string;
  description: string;
  tags: string[];
}): CatalogTool {
  const risk = riskFromComposioTags(input.tags);
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    risk,
    defaultEnabled: risk === "read",
    requiresApproval: risk === "sensitive",
  };
}

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

export function classifyMetaExecution(input: {
  metaToolSlug: string;
  args: Record<string, unknown>;
  riskByTool: Map<string, IntegrationToolRisk>;
}): { allowed: boolean; mutating: boolean; toolSlugs: string[] } {
  const toolSlugs =
    input.metaToolSlug === "COMPOSIO_GET_TOOL_SCHEMAS"
      ? (Array.isArray(input.args.tool_slugs)
          ? input.args.tool_slugs.filter((slug): slug is string => typeof slug === "string")
          : [])
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
