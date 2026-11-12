export interface RelevantToolCandidate {
  slug: string;
  name?: string;
  description?: string;
  toolkitSlug: string;
  inputParameters?: Record<string, unknown>;
  outputParameters?: Record<string, unknown>;
}

export interface EnabledConnection {
  toolkitSlug: string;
  connectionId: string;
}

export interface EnabledPolicy {
  toolkitSlug: string;
  allowedTools: Array<{
    slug: string;
    risk: "read" | "write" | "sensitive";
  }>;
}

export interface DiscoveredAgentTool {
  name: string;
  displayName: string;
  description: string;
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  connectionId: string;
  toolkitSlug: string;
  risk: "read" | "write" | "sensitive";
}

export type AgentToolDiscoveryStatus =
  | "ready"
  | "disabled"
  | "not_configured"
  | "channel_restricted"
  | "no_active_connection"
  | "policy_denied"
  | "no_matching_tool";

export interface AgentToolDiscoveryResult {
  tools: DiscoveredAgentTool[];
  status: AgentToolDiscoveryStatus;
  message: string;
  relevantToolkits: string[];
}

const TOOL_QUERY_STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "for",
  "in",
  "into",
  "me",
  "my",
  "new",
  "of",
  "on",
  "out",
  "please",
  "the",
  "to",
  "with",
]);

const ARGUMENT_BOUNDARY = new Set([
  "body",
  "called",
  "content",
  "from",
  "name",
  "named",
  "saying",
  "text",
  "title",
  "titled",
]);

const TOOL_ACTION_WORDS = new Set([
  "list",
  "find",
  "search",
  "fetch",
  "get",
  "read",
  "show",
  "check",
  "count",
  "retrieve",
  "lookup",
  "inspect",
  "download",
  "create",
  "make",
  "add",
  "upload",
  "send",
  "post",
  "schedule",
  "update",
  "edit",
  "write",
  "delete",
  "remove",
  "move",
  "rename",
  "share",
  "invite",
  "archive",
  "assign",
  "publish",
]);

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function normalizeActionToken(token: string): string {
  if (TOOL_ACTION_WORDS.has(token) || token.length < 4) return token;
  return (
    [...TOOL_ACTION_WORDS].find(
      (action) => action.length >= 4 && editDistanceAtMostOne(token, action),
    ) || token
  );
}

/**
 * Composio catalog search is optimized for capability phrases rather than a
 * complete user command. Keep the action/resource words and drop concrete
 * argument values so requests such as "create a folder ... named Quarterly"
 * can still resolve the create-folder schema.
 */
export function compactConnectedToolQuery(query: string): string {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (tokens[0]) tokens[0] = normalizeActionToken(tokens[0]);
  const compact: string[] = [];

  for (const token of tokens) {
    if (ARGUMENT_BOUNDARY.has(token) && compact.length >= 2) break;
    if (TOOL_QUERY_STOP_WORDS.has(token)) continue;
    compact.push(token);
    if (compact.length >= 4) break;
  }

  return compact.join(" ");
}

/**
 * Convert user-facing verbs to capability-search vocabulary used by many
 * integration catalogs. This is integration-agnostic: for example, "list
 * channels" often maps to a FIND action and "show messages" to FETCH.
 */
export function capabilitySearchQuery(query: string): string {
  const compact = compactConnectedToolQuery(query);
  const tokens = compact.split(" ").filter(Boolean);
  if (tokens.length === 0) return compact;

  const aliases: Record<string, string> = {
    list: "find",
    show: "find",
    retrieve: "get",
    read: "fetch",
    lookup: "find",
  };
  tokens[0] = aliases[tokens[0]] || tokens[0];
  // Text following "write" is usually payload, not capability vocabulary.
  // Catalogs consistently expose this action as insert/update text.
  if (tokens[0] === "write") return "insert text";
  return tokens.join(" ");
}

/**
 * Extract a small set of independent capability searches from a compound user
 * request. Concrete values after boundaries such as "name" and "from" are
 * excluded. A resource-focused variant ("upload folder") helps catalogs match
 * actions when the resource has a user-supplied modifier ("portfolio folder").
 */
export function capabilitySearchQueries(query: string): string[] {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      index === 0 ||
      tokens[index - 1] === "and" ||
      tokens[index - 1] === "then"
    ) {
      tokens[index] = normalizeActionToken(tokens[index]);
    }
  }
  const actionIndexes = tokens
    .map((token, index) => (TOOL_ACTION_WORDS.has(token) ? index : -1))
    .filter((index) => index >= 0);
  const clauses = actionIndexes.length
    ? actionIndexes.map((start, index) =>
        tokens
          .slice(start, actionIndexes[index + 1] ?? tokens.length)
          .join(" "),
      )
    : [query];
  const results: string[] = [];

  for (const clause of clauses.slice(0, 4)) {
    const capability = capabilitySearchQuery(clause);
    if (capability && !results.includes(capability)) results.push(capability);

    const capabilityTokens = capability.split(" ").filter(Boolean);
    if (capabilityTokens.length > 2) {
      const resourceVariant = `${capabilityTokens[0]} ${capabilityTokens[capabilityTokens.length - 1]}`;
      if (!results.includes(resourceVariant)) results.push(resourceVariant);
    }
  }

  return results.slice(0, 6);
}

/** Preserve relevance for every clause in a compound request. */
export function mergeCandidateGroupsRoundRobin<T extends { slug: string }>(
  groups: T[][],
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      const candidate = group[index];
      if (!candidate || seen.has(candidate.slug)) continue;
      seen.add(candidate.slug);
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Rank authorized tool slugs when Composio's semantic catalog search returns
 * no rows. This operates only on policy-enabled slugs and is used to fetch a
 * bounded set of exact schemas, never the complete catalog.
 */
export function rankAuthorizedToolSlugs(
  query: string,
  toolSlugs: string[],
  limit: number,
): string[] {
  const queryTokens = new Set(
    capabilitySearchQueries(query)
      .join(" ")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.map(canonicalCapabilityToken) || [],
  );
  const actionTokens = new Set(
    [...queryTokens].filter((token) => TOOL_ACTION_WORDS.has(token)),
  );

  return toolSlugs
    .map((slug, index) => {
      const rawSlugTokens = slug.toLowerCase().match(/[a-z0-9]+/g) || [];
      const slugAction = canonicalCapabilityToken(rawSlugTokens[1] || "");
      const resourceTokens = new Set(
        rawSlugTokens.slice(2).map(canonicalCapabilityToken),
      );
      const compactResource = rawSlugTokens.slice(2).map(stemToken).join("");
      let score = 0;
      for (const token of queryTokens) {
        if (actionTokens.has(token)) {
          if (slugAction === token) score += 6;
          continue;
        }
        if (resourceTokens.has(token) || compactResource.includes(token)) {
          score += 2;
        }
      }
      return { slug, score, index };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((candidate) => candidate.slug);
}

/** Build discovery queries for IDs a mutation requires but the user did not supply. */
export function requiredIdentifierQueries(
  candidates: RelevantToolCandidate[],
): string[] {
  const queries: string[] = [];
  for (const candidate of candidates) {
    const schema = candidate.inputParameters as
      | { required?: unknown; properties?: Record<string, unknown> }
      | undefined;
    const required = Array.isArray(schema?.required) ? schema.required : [];
    for (const field of required) {
      if (typeof field !== "string" || !/(?:^|_)ids?$/i.test(field)) continue;
      const resource = field
        .replace(/(?:^|_)ids?$/i, "")
        .replace(/_/g, " ")
        .trim();
      if (!resource) continue;
      const query = `find ${resource}`;
      if (!queries.includes(query)) queries.push(query);
      if (queries.length >= 4) return queries;
    }
  }
  return queries;
}

export function mentionedToolkitSlugs(
  query: string,
  toolkitSlugs: string[],
): string[] {
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  return toolkitSlugs.filter((slug) =>
    normalized.includes(slug.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
}

export function isConnectedToolChannelAllowed(
  channel: string,
  configuredChannels: string,
): boolean {
  return configuredChannels
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(channel.toLowerCase());
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4)
    return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function canonicalCapabilityToken(token: string): string {
  const stemmed = stemToken(token);
  const aliases: Record<string, string> = {
    list: "find",
    show: "find",
    search: "find",
    lookup: "find",
    read: "get",
    fetch: "get",
    retrieve: "get",
    make: "create",
    add: "create",
    post: "send",
  };
  return aliases[stemmed] || stemmed;
}

/**
 * Detect when Composio search returned tools for the named product but not for
 * the requested resource. This allows a second, still-authorized search across
 * connected toolkits for cross-product storage relationships (documents in a
 * drive, attachments in mail, and similar cases) without loading the catalog.
 */
function requestedResourceTokens(
  query: string,
  mentionedToolkits: string[],
): string[] {
  const ignored = new Set([
    ...TOOL_QUERY_STOP_WORDS,
    ...TOOL_ACTION_WORDS,
    "google",
    "microsoft",
  ]);
  for (const slug of mentionedToolkits) {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const vendor of ["google", "microsoft"]) {
      if (normalized.startsWith(vendor) && normalized.length > vendor.length) {
        ignored.add(normalized.slice(vendor.length));
      }
    }
    slug
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .forEach((token) => ignored.add(token));
  }

  return (query.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => !ignored.has(token))
    .map(stemToken);
}

export function crossToolkitCapabilitySearchQuery(
  query: string,
  mentionedToolkits: string[],
): string {
  const action = capabilitySearchQuery(query).split(" ")[0] || "find";
  const resources = requestedResourceTokens(query, mentionedToolkits);
  return [action, ...resources].slice(0, 4).join(" ").trim();
}

export function candidatesMatchRequestedResources(
  query: string,
  candidates: RelevantToolCandidate[],
  mentionedToolkits: string[],
): boolean {
  const resources = requestedResourceTokens(query, mentionedToolkits);
  if (resources.length === 0) return true;

  return candidates.some((candidate) => {
    const identity =
      `${candidate.slug} ${candidate.name || ""}`
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.map(stemToken) || [];
    return resources.some((resource) => identity.includes(resource));
  });
}

/**
 * Intersect Composio-ranked results with tenant connections and policy.
 * Candidate order is preserved, so the LLM receives the SDK's most relevant
 * schemas without seeing disabled integrations or the full catalog.
 */
export function selectRelevantConnectedTools(input: {
  candidates: RelevantToolCandidate[];
  connections: EnabledConnection[];
  policies: EnabledPolicy[];
  limit: number;
}): DiscoveredAgentTool[] {
  const connectionByToolkit = new Map(
    input.connections.map((connection) => [connection.toolkitSlug, connection]),
  );
  const policyByToolkit = new Map(
    input.policies.map((policy) => [policy.toolkitSlug, policy]),
  );
  const seen = new Set<string>();
  const result: DiscoveredAgentTool[] = [];

  for (const tool of input.candidates) {
    if (result.length >= input.limit) break;
    const connection = connectionByToolkit.get(tool.toolkitSlug);
    const policyTool = policyByToolkit
      .get(tool.toolkitSlug)
      ?.allowedTools.find((entry) => entry.slug === tool.slug);
    if (!connection || !policyTool || seen.has(tool.slug)) continue;

    seen.add(tool.slug);
    result.push({
      name: tool.slug,
      displayName: tool.name || tool.slug,
      description:
        tool.description ||
        `Execute ${tool.name || tool.slug} through the connected ${tool.toolkitSlug} integration.`,
      parameters: tool.inputParameters || {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: tool.outputParameters,
      connectionId: connection.connectionId,
      toolkitSlug: tool.toolkitSlug,
      risk: policyTool.risk,
    });
  }

  return result;
}
