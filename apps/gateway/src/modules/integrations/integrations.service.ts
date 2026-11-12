import { Types } from "mongoose";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import {
  IntegrationAuditEvent,
  IntegrationConnection,
  IntegrationPolicy,
} from "@shared/models";
import { composioAdapter, buildComposioUserId } from "./composio.adapter";
import {
  CatalogToolkit,
  INTEGRATION_CATALOG,
  mergeToolkitTools,
} from "./integrations.policy";
import {
  canonicalizeArguments,
  safeIntegrationError,
} from "./integrations.utils";
import { validateToolArguments } from "./integration-schema";
import {
  AgentToolDiscoveryResult,
  candidatesMatchRequestedResources,
  crossToolkitCapabilitySearchQuery,
  capabilitySearchQueries,
  compactConnectedToolQuery,
  isConnectedToolChannelAllowed,
  mergeCandidateGroupsRoundRobin,
  rankAuthorizedToolSlugs,
  requiredIdentifierQueries,
  mentionedToolkitSlugs,
  selectRelevantConnectedTools,
} from "./integration-discovery";

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const TOOL_SCHEMA_CACHE_MS = 5 * 60 * 1000;
const AGENT_TOOL_LIMIT = Math.min(
  30,
  Math.max(1, parseInt(process.env.COMPOSIO_AGENT_TOOL_LIMIT || "12", 10)),
);

type ToolkitSummary = Omit<CatalogToolkit, "tools">;

let directoryCache: { value: ToolkitSummary[]; expiresAt: number } | undefined;
let directoryRequest: Promise<ToolkitSummary[]> | undefined;
const toolkitCache = new Map<
  string,
  { value: CatalogToolkit; expiresAt: number }
>();
const toolSchemaCache = new Map<
  string,
  {
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    expiresAt: number;
  }
>();

function toolSchemaKey(toolkitSlug: string, toolSlug: string): string {
  return `${toolkitSlug.toLowerCase()}:${toolSlug}`;
}

function rememberToolSchema(
  toolkitSlug: string,
  toolSlug: string,
  inputSchema?: Record<string, unknown>,
  outputSchema?: Record<string, unknown>,
): void {
  if (!inputSchema) return;
  toolSchemaCache.set(toolSchemaKey(toolkitSlug, toolSlug), {
    inputSchema,
    outputSchema,
    expiresAt: Date.now() + TOOL_SCHEMA_CACHE_MS,
  });
  if (toolSchemaCache.size > 1000) {
    const oldestKey = toolSchemaCache.keys().next().value as string | undefined;
    if (oldestKey) toolSchemaCache.delete(oldestKey);
  }
}

async function executionToolSchema(toolkitSlug: string, toolSlug: string) {
  const key = toolSchemaKey(toolkitSlug, toolSlug);
  const cached = toolSchemaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const tool = await composioAdapter.getCatalogTool(toolSlug);
  if (
    !tool ||
    tool.toolkitSlug !== toolkitSlug.toLowerCase() ||
    !tool.inputParameters
  ) {
    throw new AppError("Integration tool schema is unavailable", 502);
  }
  rememberToolSchema(
    toolkitSlug,
    toolSlug,
    tool.inputParameters,
    tool.outputParameters,
  );
  return toolSchemaCache.get(key)!;
}

async function executeReadTool(
  input: Parameters<typeof composioAdapter.execute>[0],
): Promise<unknown> {
  try {
    return await composioAdapter.execute(input);
  } catch (firstError) {
    // Read actions are side-effect free and safe to retry once on a transient
    // provider failure. Mutations deliberately never use this helper.
    if (!(firstError instanceof AppError) || firstError.statusCode !== 502) {
      throw firstError;
    }
    return composioAdapter.execute(input);
  }
}

const staticToolkit = (slug: string) =>
  INTEGRATION_CATALOG.find((toolkit) => toolkit.slug === slug.toLowerCase());

async function resolvedDirectory(): Promise<ToolkitSummary[]> {
  const fallback = INTEGRATION_CATALOG.map(({ tools, ...toolkit }) => ({
    ...toolkit,
    toolsCount: toolkit.toolsCount ?? tools.length,
  }));
  if (!composioAdapter.isAvailable()) return fallback;
  if (directoryCache && directoryCache.expiresAt > Date.now())
    return directoryCache.value;
  if (directoryRequest) return directoryRequest;

  directoryRequest = composioAdapter
    .listToolkits()
    .then((value) => {
      directoryCache = { value, expiresAt: Date.now() + CATALOG_CACHE_MS };
      return value;
    })
    .catch(() => directoryCache?.value ?? fallback)
    .finally(() => {
      directoryRequest = undefined;
    });
  return directoryRequest;
}

async function resolvedToolkit(
  toolkitSlug: string,
): Promise<CatalogToolkit | undefined> {
  const slug = toolkitSlug.toLowerCase();
  const cached = toolkitCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const summary = (await resolvedDirectory()).find(
    (toolkit) => toolkit.slug === slug,
  );
  if (!summary) return undefined;
  const base = staticToolkit(slug) ?? { ...summary, tools: [] };
  if (!composioAdapter.isAvailable()) return base;

  try {
    const tools = await composioAdapter.listCatalogTools([slug]);
    const value = mergeToolkitTools({ ...base, ...summary }, tools);
    toolkitCache.set(slug, {
      value,
      expiresAt: Date.now() + CATALOG_CACHE_MS,
    });
    return value;
  } catch {
    return cached?.value ?? base;
  }
}

async function audit(input: {
  organizationId: string;
  actorUserId?: string;
  connectionId?: Types.ObjectId;
  eventType: string;
  toolkitSlug?: string;
  toolSlug?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  await IntegrationAuditEvent.create({
    ...input,
    metadata: input.metadata ?? {},
  });
}

function statusFromComposio(status: string, disabled: boolean) {
  if (disabled || status === "INACTIVE" || status === "REVOKED")
    return "disconnected" as const;
  if (status === "ACTIVE") return "active" as const;
  if (status === "EXPIRED") return "expired" as const;
  if (status === "FAILED") return "error" as const;
  return "pending" as const;
}

export class IntegrationsService {
  /**
   * Discover Composio tools available to the existing AI agent.
   * Workspace policy and active connected accounts are resolved here so the
   * agent never receives a tool it is not permitted to call.
   */
  async discoverAgentTools(
    organizationId: string,
    query: string,
    channel = "widget",
  ): Promise<AgentToolDiscoveryResult> {
    if (
      !isConnectedToolChannelAllowed(
        channel,
        process.env.COMPOSIO_AGENT_CHANNELS || "widget,email,whatsapp,telegram",
      )
    ) {
      return {
        tools: [],
        status: "channel_restricted",
        message: `Connected integrations are disabled for the ${channel} channel`,
        relevantToolkits: [],
      };
    }
    const [connections, policies] = await Promise.all([
      IntegrationConnection.find({
        organizationId,
      })
        .select("+composioUserId")
        .sort({ updatedAt: -1 }),
      IntegrationPolicy.find({ organizationId, enabled: true }).lean(),
    ]);

    const knownToolkitSlugs = [
      ...new Set([
        ...connections.map((connection) => connection.toolkitSlug),
        ...policies.map((policy) => policy.toolkitSlug),
      ]),
    ];
    const mentionedToolkits = mentionedToolkitSlugs(query, knownToolkitSlugs);
    if (!config.composio.enabled) {
      return {
        tools: [],
        status: "disabled",
        message: "Composio integrations are disabled for this deployment",
        relevantToolkits: mentionedToolkits,
      };
    }
    if (!config.composio.apiKey) {
      return {
        tools: [],
        status: "not_configured",
        message:
          "Composio is enabled but its project API key is not configured",
        relevantToolkits: mentionedToolkits,
      };
    }
    const searchToolkits =
      mentionedToolkits.length > 0 ? mentionedToolkits : knownToolkitSlugs;
    const relevantConnections = connections.filter((connection) =>
      searchToolkits.includes(connection.toolkitSlug),
    );
    const activeConnections = relevantConnections.filter(
      (connection) => connection.status === "active",
    );
    if (activeConnections.length === 0) {
      const observedStatuses = [
        ...new Set(relevantConnections.map((connection) => connection.status)),
      ];
      return {
        tools: [],
        status: "no_active_connection",
        message:
          observedStatuses.length > 0
            ? `No active connected account is available (current state: ${observedStatuses.join(", ")})`
            : "No connected account is available for the requested integration",
        relevantToolkits: mentionedToolkits,
      };
    }

    const policyByToolkit = new Map(
      policies.map((policy) => [policy.toolkitSlug, policy]),
    );
    const selectedConnections = new Map<string, (typeof connections)[number]>();

    // If multiple operators connected the same toolkit, use the most recently
    // updated active account. Execution revalidates provider ownership/status.
    // Keep every authorized active connection eligible for a bounded fallback
    // search. Some resources live in a companion service (for example Google
    // Docs files are listed by Drive), even when the user names the editor.
    for (const connection of connections.filter(
      (candidate) => candidate.status === "active",
    )) {
      if (selectedConnections.has(connection.toolkitSlug)) continue;
      const policy = policyByToolkit.get(connection.toolkitSlug);
      if (!policy || policy.allowedTools.length === 0) continue;
      selectedConnections.set(connection.toolkitSlug, connection);
    }

    const toolkitSlugs = [...selectedConnections.keys()];
    const primaryToolkitSlugs =
      mentionedToolkits.length > 0
        ? toolkitSlugs.filter((slug) => mentionedToolkits.includes(slug))
        : toolkitSlugs;
    if (primaryToolkitSlugs.length === 0) {
      return {
        tools: [],
        status: "policy_denied",
        message:
          "An account is connected, but workspace policy enables no tools for the requested integration",
        relevantToolkits: mentionedToolkits,
      };
    }

    // One native Composio relevance query replaces loading every schema into
    // the model. Results retain Composio ordering and complete JSON Schemas.
    const capabilityQueries = capabilitySearchQueries(query);
    const candidateGroups = await Promise.all(
      (capabilityQueries.length > 0 ? capabilityQueries : [query]).map(
        (capabilityQuery) =>
          composioAdapter.searchCatalogTools(
            primaryToolkitSlugs,
            capabilityQuery,
            Math.max(AGENT_TOOL_LIMIT * 3, AGENT_TOOL_LIMIT),
          ),
      ),
    );
    let candidates = mergeCandidateGroupsRoundRobin(candidateGroups);
    if (
      mentionedToolkits.length > 0 &&
      toolkitSlugs.length > primaryToolkitSlugs.length &&
      !candidatesMatchRequestedResources(query, candidates, mentionedToolkits)
    ) {
      const broadCandidates = await composioAdapter.searchCatalogTools(
        toolkitSlugs,
        crossToolkitCapabilitySearchQuery(query, mentionedToolkits) || query,
        Math.max(AGENT_TOOL_LIMIT * 3, AGENT_TOOL_LIMIT),
      );
      candidates = [...broadCandidates, ...candidates].filter(
        (candidate, index, all) =>
          all.findIndex((other) => other.slug === candidate.slug) === index,
      );
    }
    if (candidates.length === 0) {
      const compactQuery = compactConnectedToolQuery(query);
      if (compactQuery && !capabilityQueries.includes(compactQuery)) {
        candidates = await composioAdapter.searchCatalogTools(
          toolkitSlugs,
          compactQuery,
          Math.max(AGENT_TOOL_LIMIT * 3, AGENT_TOOL_LIMIT),
        );
      }
    }
    if (candidates.length === 0) {
      const authorizedSlugs = policies
        .filter((policy) => toolkitSlugs.includes(policy.toolkitSlug))
        .flatMap((policy) => policy.allowedTools.map((tool) => tool.slug));
      const fallbackSlugs = rankAuthorizedToolSlugs(
        query,
        authorizedSlugs,
        Math.max(AGENT_TOOL_LIMIT * 3, AGENT_TOOL_LIMIT),
      );
      candidates = await composioAdapter.getCatalogTools(fallbackSlugs);
    }

    // Mutation schemas commonly require a container/resource ID (tasklist_id,
    // folder_id, channel_id, etc.). Discover the authorized read tool that can
    // resolve it so the model never has to copy a documentation example or ask
    // the user for data available through the connected account.
    const policyRisk = new Map(
      policies.flatMap((policy) =>
        policy.allowedTools.map(
          (tool) => [`${policy.toolkitSlug}:${tool.slug}`, tool.risk] as const,
        ),
      ),
    );
    const mutationCandidates = candidates.filter((candidate) => {
      const risk = policyRisk.get(`${candidate.toolkitSlug}:${candidate.slug}`);
      return Boolean(risk && risk !== "read");
    });
    const resolverQueries = requiredIdentifierQueries(mutationCandidates);
    if (resolverQueries.length > 0) {
      const resolverToolkitSlugs = [
        ...new Set(
          mutationCandidates.map((candidate) => candidate.toolkitSlug),
        ),
      ];
      const authorizedSlugs = policies
        .filter((policy) => resolverToolkitSlugs.includes(policy.toolkitSlug))
        .flatMap((policy) => policy.allowedTools.map((tool) => tool.slug));
      const resolverGroups = await Promise.all(
        resolverQueries.map(async (resolverQuery) => {
          const fallbackSlugs = rankAuthorizedToolSlugs(
            resolverQuery,
            authorizedSlugs,
            3,
          );
          return composioAdapter.getCatalogTools(fallbackSlugs);
        }),
      );
      candidates = mergeCandidateGroupsRoundRobin([
        candidates,
        mergeCandidateGroupsRoundRobin(resolverGroups),
      ]);
    }
    const discovered = selectRelevantConnectedTools({
      candidates,
      connections: [...selectedConnections.values()].map((connection) => ({
        toolkitSlug: connection.toolkitSlug,
        connectionId: connection._id.toString(),
      })),
      policies: policies.map((policy) => ({
        toolkitSlug: policy.toolkitSlug,
        allowedTools: policy.allowedTools.map((tool) => ({
          slug: tool.slug,
          risk: tool.risk,
        })),
      })),
      limit: AGENT_TOOL_LIMIT,
    });
    if (discovered.length === 0) {
      return {
        tools: [],
        status: candidates.length > 0 ? "policy_denied" : "no_matching_tool",
        message:
          candidates.length > 0
            ? "Composio found relevant capabilities, but workspace policy does not authorize them"
            : "Composio returned no capability matching this request for the active connected accounts",
        relevantToolkits: toolkitSlugs,
      };
    }

    // Database state can be stale after a provider-side revoke. Validate only
    // the small set of accounts selected by intent-aware search before exposing
    // their schemas to the model.
    const liveConnections = new Set<string>();
    for (const tool of discovered) {
      if (liveConnections.has(tool.connectionId)) continue;
      const connection = selectedConnections.get(tool.toolkitSlug);
      if (!connection) continue;
      const owned = await composioAdapter.getOwnedAccount({
        composioUserId: connection.composioUserId,
        toolkitSlug: connection.toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
      });
      if (owned?.status === "ACTIVE" && !owned.isDisabled) {
        liveConnections.add(tool.connectionId);
      }
    }
    const liveTools = discovered.filter((tool) =>
      liveConnections.has(tool.connectionId),
    );
    if (liveTools.length === 0) {
      return {
        tools: [],
        status: "no_active_connection",
        message:
          "The stored integration connection is not active at the provider",
        relevantToolkits: toolkitSlugs,
      };
    }

    for (const tool of liveTools) {
      rememberToolSchema(
        tool.toolkitSlug,
        tool.name,
        tool.parameters,
        tool.outputSchema,
      );
    }

    return {
      tools: liveTools,
      status: "ready",
      message: `Discovered ${liveTools.length} authorized connected tool${liveTools.length === 1 ? "" : "s"}`,
      relevantToolkits: toolkitSlugs,
    };
  }

  async requestAgentExecution(
    organizationId: string,
    input: {
      connectionId: string;
      toolSlug: string;
      arguments: Record<string, unknown>;
    },
  ) {
    const connection = await IntegrationConnection.findOne({
      _id: input.connectionId,
      organizationId,
      status: "active",
    }).select("createdBy");
    if (!connection)
      throw new AppError("Active integration connection not found", 404);

    return this.requestExecution(
      organizationId,
      connection.createdBy.toString(),
      input,
    );
  }

  async catalog(
    organizationId: string,
    input: { page: number; limit: number; search?: string },
  ) {
    const directory = await resolvedDirectory();
    const search = input.search?.trim().toLowerCase();
    const filtered = search
      ? directory.filter((toolkit) =>
          `${toolkit.name} ${toolkit.description} ${toolkit.category ?? ""}`
            .toLowerCase()
            .includes(search),
        )
      : directory;
    const start = (input.page - 1) * input.limit;
    const pageToolkits = filtered.slice(start, start + input.limit);
    const policies = await IntegrationPolicy.find({ organizationId }).lean();
    const byToolkit = new Map(
      policies.map((policy) => [policy.toolkitSlug, policy]),
    );
    return {
      available: composioAdapter.isAvailable(),
      enabled: config.composio.enabled,
      toolkits: pageToolkits.map((toolkit) => ({
        ...toolkit,
        policy: byToolkit.get(toolkit.slug) ?? {
          enabled: true,
          allowedTools: [],
        },
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / input.limit)),
      },
    };
  }

  async toolkit(organizationId: string, toolkitSlug: string) {
    const toolkit = await resolvedToolkit(toolkitSlug);
    if (!toolkit) throw new AppError("Integration toolkit was not found", 404);
    const policy = await IntegrationPolicy.findOne({
      organizationId,
      toolkitSlug: toolkit.slug,
    }).lean();
    return {
      available: composioAdapter.isAvailable(),
      enabled: config.composio.enabled,
      toolkit: {
        ...toolkit,
        policy: policy ?? {
          enabled: true,
          allowedTools: toolkit.tools
            .filter((tool) => tool.defaultEnabled)
            .map(({ slug, risk }) => ({ slug, risk })),
        },
      },
    };
  }

  async updatePolicy(
    organizationId: string,
    userId: string,
    toolkitSlug: string,
    input: {
      enabled: boolean;
      allowedTools: Array<{
        slug: string;
        risk: "read" | "write" | "sensitive";
      }>;
    },
  ) {
    const toolkit = await resolvedToolkit(toolkitSlug);
    if (!toolkit) throw new AppError("Integration toolkit is not allowed", 404);
    const unique = new Set<string>();
    for (const entry of input.allowedTools) {
      const catalogTool = toolkit.tools.find(
        (tool) => tool.slug === entry.slug,
      );
      if (
        !catalogTool ||
        catalogTool.risk !== entry.risk ||
        unique.has(entry.slug)
      ) {
        throw new AppError("Integration policy contains an invalid tool", 400);
      }
      unique.add(entry.slug);
    }
    const policy = await IntegrationPolicy.findOneAndUpdate(
      { organizationId, toolkitSlug },
      {
        enabled: input.enabled,
        allowedTools: input.allowedTools,
        updatedBy: userId,
      },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    await audit({
      organizationId,
      actorUserId: userId,
      eventType: "policy_updated",
      toolkitSlug,
      success: true,
      metadata: {
        enabled: input.enabled,
        toolCount: input.allowedTools.length,
      },
    });
    return policy;
  }

  async listConnections(organizationId: string, userId: string) {
    return IntegrationConnection.find({
      organizationId,
      createdBy: userId,
      status: { $ne: "disconnected" },
    })
      .select(
        "toolkitSlug connectedAccountId status displayLabel lastError createdBy createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .lean();
  }

  async connect(organizationId: string, userId: string, toolkitSlug: string) {
    const toolkit = await resolvedToolkit(toolkitSlug);
    if (!toolkit) throw new AppError("Integration toolkit is not allowed", 404);
    let policy: any = await IntegrationPolicy.findOne({
      organizationId,
      toolkitSlug,
    }).lean();
    if (!policy) {
      policy = await IntegrationPolicy.create({
        organizationId,
        toolkitSlug,
        enabled: true,
        allowedTools: toolkit.tools
          .filter((tool) => tool.defaultEnabled)
          .map(({ slug, risk }) => ({ slug, risk })),
        updatedBy: userId,
      }).then((document) => document.toObject());
    }
    if (!policy.enabled || policy.allowedTools.length === 0)
      throw new AppError(
        "This integration is disabled by workspace policy",
        403,
      );

    const composioUserId = buildComposioUserId(organizationId, userId);
    const link = await composioAdapter.createConnectLink({
      composioUserId,
      toolkitSlug,
      allowedToolSlugs: policy.allowedTools.map(
        (tool: { slug: string }) => tool.slug,
      ),
      callbackUrl: config.composio.redirectUrl,
    });
    const connection = await IntegrationConnection.findOneAndUpdate(
      {
        organizationId,
        createdBy: userId,
        toolkitSlug,
        connectedAccountId: link.connectedAccountId,
      },
      {
        composioUserId,
        status: "pending",
        lastError: null,
        disconnectedAt: null,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    await audit({
      organizationId,
      actorUserId: userId,
      connectionId: connection._id,
      eventType: "connection_started",
      toolkitSlug,
      success: true,
    });
    return { connectionId: connection._id, authorizationUrl: link.redirectUrl };
  }

  async reconcile(organizationId: string, userId: string, toolkitSlug: string) {
    const connection = await IntegrationConnection.findOne({
      organizationId,
      createdBy: userId,
      toolkitSlug,
      status: { $ne: "disconnected" },
    })
      .select("+composioUserId")
      .sort({ createdAt: -1 });
    if (!connection) return null;
    try {
      const account = await composioAdapter.getOwnedAccount({
        composioUserId: connection.composioUserId,
        toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
      });
      if (!account)
        throw new AppError(
          "Connected account does not belong to this user",
          404,
        );
      const nextStatus = statusFromComposio(account.status, account.isDisabled);
      const activated =
        connection.status !== "active" && nextStatus === "active";
      connection.status = nextStatus;
      connection.displayLabel = account.alias?.slice(0, 160) || null;
      connection.lastError =
        nextStatus === "error"
          ? (account.statusReason || "Connection failed").slice(0, 500)
          : null;
      await connection.save();
      if (activated)
        await audit({
          organizationId,
          actorUserId: userId,
          connectionId: connection._id,
          eventType: "connection_activated",
          toolkitSlug,
          success: true,
        });
    } catch (error) {
      connection.status = "error";
      connection.lastError = safeIntegrationError(error);
      await connection.save();
      await audit({
        organizationId,
        actorUserId: userId,
        connectionId: connection._id,
        eventType: "connection_failed",
        toolkitSlug,
        success: false,
      });
    }
    const result = connection.toObject() as unknown as Record<string, unknown>;
    delete result.composioUserId;
    return result;
  }

  async disconnect(
    organizationId: string,
    userId: string,
    connectionId: string,
  ) {
    const connection = await IntegrationConnection.findOne({
      _id: connectionId,
      organizationId,
      createdBy: userId,
    }).select("+composioUserId");
    if (!connection)
      throw new AppError("Integration connection not found", 404);
    connection.status = "disconnected";
    connection.disconnectedAt = new Date();
    await connection.save();
    let remoteRevoked = true;
    try {
      const owned = await composioAdapter.getOwnedAccount({
        composioUserId: connection.composioUserId,
        toolkitSlug: connection.toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
      });
      if (owned)
        await composioAdapter.disconnect(connection.connectedAccountId);
    } catch {
      remoteRevoked = false;
      connection.lastError =
        "Local access was removed, but provider revocation could not be confirmed";
      await connection.save();
    }
    await audit({
      organizationId,
      actorUserId: userId,
      connectionId: connection._id,
      eventType: "disconnected",
      toolkitSlug: connection.toolkitSlug,
      success: remoteRevoked,
      metadata: { remoteRevoked },
    });
    return { disconnected: true, remoteRevoked };
  }

  private async executionContext(
    organizationId: string,
    userId: string,
    connectionId: string,
    toolSlug: string,
  ) {
    const connection = await IntegrationConnection.findOne({
      _id: connectionId,
      organizationId,
      createdBy: userId,
      status: "active",
    }).select("+composioUserId");
    if (!connection)
      throw new AppError("Active integration connection not found", 404);
    const policy = await IntegrationPolicy.findOne({
      organizationId,
      toolkitSlug: connection.toolkitSlug,
      enabled: true,
    }).lean();
    const policyTool = policy?.allowedTools.find(
      (tool) => tool.slug === toolSlug,
    );
    const toolkit = await resolvedToolkit(connection.toolkitSlug);
    const catalogTool = toolkit?.tools.find((tool) => tool.slug === toolSlug);
    if (!policyTool || !catalogTool || policyTool.risk !== catalogTool.risk)
      throw new AppError("Integration action is not allowed", 403);
    const owned = await composioAdapter.getOwnedAccount({
      composioUserId: connection.composioUserId,
      toolkitSlug: connection.toolkitSlug,
      connectedAccountId: connection.connectedAccountId,
    });
    if (!owned || owned.status !== "ACTIVE" || owned.isDisabled)
      throw new AppError("Integration connection is no longer active", 409);
    return { connection, catalogTool };
  }

  async requestExecution(
    organizationId: string,
    userId: string,
    input: {
      connectionId: string;
      toolSlug: string;
      arguments: Record<string, unknown>;
    },
  ) {
    const { connection, catalogTool } = await this.executionContext(
      organizationId,
      userId,
      input.connectionId,
      input.toolSlug,
    );
    const canonical = canonicalizeArguments(input.arguments);
    const schema = await executionToolSchema(
      connection.toolkitSlug,
      input.toolSlug,
    );
    validateToolArguments(
      input.toolSlug,
      schema.inputSchema,
      canonical.arguments,
    );
    await audit({
      organizationId,
      actorUserId: userId,
      connectionId: connection._id,
      eventType: "tool_requested",
      toolkitSlug: connection.toolkitSlug,
      toolSlug: input.toolSlug,
      success: true,
      metadata: { argumentHash: canonical.hash },
    });
    try {
      const executionInput = {
        composioUserId: connection.composioUserId,
        toolkitSlug: connection.toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
        toolSlug: input.toolSlug,
        arguments: canonical.arguments,
      };
      // Reads may be retried once on a transient provider failure. Mutations
      // execute exactly once to avoid duplicate external side effects.
      const result =
        catalogTool.risk === "read"
          ? await executeReadTool(executionInput)
          : await composioAdapter.execute(executionInput);
      await audit({
        organizationId,
        actorUserId: userId,
        connectionId: connection._id,
        eventType: "tool_executed",
        toolkitSlug: connection.toolkitSlug,
        toolSlug: input.toolSlug,
        success: true,
        metadata: { argumentHash: canonical.hash },
      });
      return { executed: true, result };
    } catch (error) {
      await audit({
        organizationId,
        actorUserId: userId,
        connectionId: connection._id,
        eventType: "tool_failed",
        toolkitSlug: connection.toolkitSlug,
        toolSlug: input.toolSlug,
        success: false,
        metadata: { argumentHash: canonical.hash },
      });
      throw error;
    }
  }
}
