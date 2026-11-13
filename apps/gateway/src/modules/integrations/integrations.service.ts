import { randomUUID } from "crypto";
import { Types } from "mongoose";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import {
  IntegrationApproval,
  IntegrationAuditEvent,
  IntegrationConnection,
  IntegrationExecution,
  IntegrationPolicy,
  IntegrationSession,
  IntegrationToolRisk,
} from "@shared/models";
import {
  buildComposioUserId,
  composioAdapter,
  ComposioToolInputRequiredError,
  NativeSessionTool,
} from "./composio.adapter";
import {
  canonicalizeArguments,
  boundedResult,
  composioExecutionError,
  safeIntegrationError,
} from "./integrations.utils";
import { CatalogToolkit, catalogToolFromComposio } from "./integrations.policy";
import {
  buildSessionPolicy,
  BuiltSessionPolicy,
  canReuseSession,
  classifyMetaExecution,
  failedMutationOutcome,
  findDependencyPlaceholder,
  mutationExecutionIdentity,
} from "./session-policy";
import {
  COMPOSIO_GET_TOOL_SCHEMAS,
  COMPOSIO_SEARCH_TOOLS,
  extractSessionToolGrounding,
  sessionSchemaGrounding,
  sessionMetaPhase,
  validateSessionMetaCall,
} from "./session-protocol";

const SESSION_TTL_MS = Math.max(
  60_000,
  Number(process.env.COMPOSIO_SESSION_TTL_MS || 15 * 60_000),
);
const APPROVAL_TTL_MS = Math.max(
  60_000,
  Number(process.env.COMPOSIO_APPROVAL_TTL_MS || 10 * 60_000),
);
const MAX_SESSION_EXECUTIONS = Math.max(
  1,
  Number(process.env.COMPOSIO_MAX_SESSION_EXECUTIONS || 50),
);
const APPROVAL_TOOL_NAME = "INTERAONE_RESOLVE_COMPOSIO_APPROVAL";
function isChannelAllowed(channel: string): boolean {
  return (
    process.env.COMPOSIO_AGENT_CHANNELS || "widget,email,whatsapp,telegram"
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(channel.toLowerCase());
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
  if (disabled || status === "INACTIVE" || status === "REVOKED") {
    return "disconnected" as const;
  }
  if (status === "ACTIVE") return "active" as const;
  if (status === "EXPIRED") return "expired" as const;
  if (status === "FAILED") return "error" as const;
  return "pending" as const;
}

function approvalTool(
  approvals: Array<{ _id: Types.ObjectId; inputRequests: unknown }>,
): NativeSessionTool {
  const summaries = approvals.map((approval) => ({
    approvalId: approval._id.toString(),
    questions: approval.inputRequests,
  }));
  return {
    name: APPROVAL_TOOL_NAME,
    description:
      "Resolve a pending connected-app approval only after the user explicitly approves or denies it in the current conversation. Pending requests: " +
      JSON.stringify(summaries),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        approvalId: {
          type: "string",
          description:
            "The exact pending approval ID shown in this tool description.",
        },
        decision: {
          type: "string",
          enum: ["approve", "deny"],
          description:
            "Use approve only after explicit user consent; otherwise use deny.",
        },
      },
      required: ["approvalId", "decision"],
    },
  };
}

function responseInputs(
  inputRequests: Record<string, unknown>,
  decision: "approve" | "deny",
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(inputRequests).map((id) => [
      id,
      { action: "accept", content: { decision } },
    ]),
  );
}

function executionResult(result: {
  data?: unknown;
  error?: string | null;
  logId?: string;
  resultType: string;
}): Record<string, unknown> {
  const error = composioExecutionError(result);
  const envelope = {
    status: result.resultType === "completed" ? "completed" : "failed",
    resultType: result.resultType,
    data: result.data,
    error,
    logId: result.logId,
  };
  const bounded = boundedResult(envelope);
  return {
    ...(bounded && typeof bounded === "object"
      ? (bounded as Record<string, unknown>)
      : { data: bounded }),
    status: envelope.status,
    resultType: envelope.resultType,
    error: envelope.error,
    logId: envelope.logId,
  };
}

export class IntegrationsService {
  private async resolvedPolicy(
    organizationId: string,
  ): Promise<BuiltSessionPolicy | null> {
    const composioUserId = buildComposioUserId(organizationId);
    const [connections, policies] = await Promise.all([
      IntegrationConnection.find({
        organizationId,
        composioUserId,
        status: "active",
      })
        .select("+composioUserId")
        .sort({ updatedAt: -1 })
        .lean(),
      IntegrationPolicy.find({
        organizationId,
        enabled: true,
        "allowedTools.0": { $exists: true },
      }).lean(),
    ]);

    return buildSessionPolicy({
      composioUserId,
      connections: connections.map((connection) => ({
        toolkitSlug: connection.toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
        composioUserId: connection.composioUserId,
      })),
      policies: policies.map((policy) => ({
        toolkitSlug: policy.toolkitSlug,
        enabled: policy.enabled,
        allowedTools: policy.allowedTools.map((tool) => ({
          slug: tool.slug,
          risk: tool.risk,
        })),
      })),
    });
  }

  private async expireSession(session: {
    _id: Types.ObjectId;
    composioSessionId: string;
  }): Promise<void> {
    await IntegrationSession.updateOne(
      { _id: session._id, status: "active" },
      { status: "expired" },
    );
    await composioAdapter
      .deleteSession(session.composioSessionId)
      .catch(() => undefined);
  }

  private async closeOrganizationSessions(organizationId: string) {
    const sessions = await IntegrationSession.find({
      organizationId,
      status: "active",
    })
      .select("+composioSessionId")
      .lean();
    await IntegrationSession.updateMany(
      { organizationId, status: "active" },
      { status: "closed" },
    );
    await Promise.all(
      sessions.map((session) =>
        composioAdapter
          .deleteSession(session.composioSessionId)
          .catch(() => undefined),
      ),
    );
  }

  async openAgentSession(
    organizationId: string,
    conversationId: string,
    channel = "widget",
  ) {
    if (!isChannelAllowed(channel)) {
      return {
        status: "channel_restricted",
        message: `Connected integrations are disabled for the ${channel} channel`,
        tools: [],
      };
    }
    if (!config.composio.enabled) {
      return {
        status: "disabled",
        message: "Composio integrations are disabled for this deployment",
        tools: [],
      };
    }
    if (!config.composio.apiKey) {
      return {
        status: "not_configured",
        message: "Composio is enabled but its API key is not configured",
        tools: [],
      };
    }

    const policy = await this.resolvedPolicy(organizationId);
    if (!policy) {
      return {
        status: "no_active_connection",
        message:
          "No policy-authorized active integration connection is available",
        tools: [],
      };
    }

    const now = new Date();
    let stored = await IntegrationSession.findOne({
      organizationId,
      conversationId,
      status: "active",
    })
      .select("+composioSessionId +toolSchemas")
      .sort({ updatedAt: -1 });
    let tools: NativeSessionTool[];

    if (
      stored &&
      canReuseSession({
        status: stored.status,
        policyHash: stored.policyHash,
        expectedPolicyHash: policy.hash,
        expiresAt: stored.expiresAt,
        now,
      })
    ) {
      try {
        tools = await composioAdapter.sessionTools(stored.composioSessionId);
      } catch {
        await this.expireSession(stored);
        stored = null;
        tools = [];
      }
    } else {
      if (stored) await this.expireSession(stored);
      stored = null;
      tools = [];
    }

    if (!stored) {
      const created = await composioAdapter.createAgentSession(
        policy.composioUserId,
        policy.config,
      );
      tools = created.tools;
      try {
        stored = await IntegrationSession.create({
          organizationId,
          conversationId,
          composioSessionId: created.sessionId,
          policyHash: policy.hash,
          allowedMetaTools: tools.map((tool) => tool.name),
          discoveredToolSlugs: [],
          toolSchemas: {},
          status: "active",
          executionCount: 0,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          lastUsedAt: now,
        });
      } catch (error: unknown) {
        if ((error as { code?: number }).code !== 11000) throw error;
        await composioAdapter
          .deleteSession(created.sessionId)
          .catch(() => undefined);
        stored = await IntegrationSession.findOne({
          organizationId,
          conversationId,
          status: "active",
          policyHash: policy.hash,
          expiresAt: { $gt: now },
        })
          .select("+composioSessionId +toolSchemas")
          .sort({ updatedAt: -1 });
        if (!stored) {
          throw new AppError(
            "Concurrent integration session creation failed",
            409,
          );
        }
        tools = await composioAdapter.sessionTools(stored.composioSessionId);
      }
    } else {
      stored.allowedMetaTools = tools.map((tool) => tool.name);
      stored.lastUsedAt = now;
      stored.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await stored.save();
    }

    await IntegrationApproval.updateMany(
      {
        organizationId,
        conversationId,
        status: "pending",
        expiresAt: { $lte: now },
      },
      { status: "expired", resolvedAt: now },
    );
    const pendingApprovals = await IntegrationApproval.find({
      organizationId,
      conversationId,
      sessionId: stored._id,
      status: "pending",
      expiresAt: { $gt: now },
    })
      .select("inputRequests")
      .lean();
    if (pendingApprovals.length > 0) {
      tools = [...tools, approvalTool(pendingApprovals)];
    }

    return {
      status: "ready",
      message: "Native Composio session meta-tools are ready",
      sessionId: stored._id.toString(),
      tools,
      grounding: sessionSchemaGrounding({
        discoveredToolSlugs: stored.discoveredToolSlugs ?? [],
        toolSchemas: stored.toolSchemas ?? {},
      }),
    };
  }

  private async executionSession(
    organizationId: string,
    conversationId: string,
    sessionId: string,
  ) {
    const session = await IntegrationSession.findOne({
      _id: sessionId,
      organizationId,
      conversationId,
      status: "active",
      expiresAt: { $gt: new Date() },
    }).select("+composioSessionId +toolSchemas");
    if (!session) {
      throw new AppError("Integration session is missing or expired", 409);
    }
    return session;
  }

  private async resolveApproval(
    organizationId: string,
    conversationId: string,
    sessionId: string,
    input: Record<string, unknown>,
  ) {
    const approvalId = String(input.approvalId || "");
    const decision = String(input.decision || "") as "approve" | "deny";
    if (!approvalId || !["approve", "deny"].includes(decision)) {
      throw new AppError("A valid approval ID and decision are required", 400);
    }
    const approval = await IntegrationApproval.findOne({
      _id: approvalId,
      organizationId,
      conversationId,
      sessionId,
    }).select("+requestState");
    if (!approval) throw new AppError("Approval request not found", 404);

    const execution = await IntegrationExecution.findById(approval.executionId);
    if (!execution)
      throw new AppError("Approval execution record not found", 409);
    if (approval.status !== "pending") {
      return (
        execution.result ?? {
          status: approval.status === "approved" ? "completed" : "denied",
        }
      );
    }
    if (approval.expiresAt <= new Date()) {
      approval.status = "expired";
      approval.resolvedAt = new Date();
      await approval.save();
      throw new AppError("Approval request expired", 409);
    }

    const session = await this.executionSession(
      organizationId,
      conversationId,
      sessionId,
    );
    approval.status = decision === "deny" ? "denied" : "approved";
    approval.resolvedAt = new Date();
    await Promise.all([approval.save(), execution.save()]);
    try {
      const result = await composioAdapter.executeMeta(
        session.composioSessionId,
        approval.metaToolSlug,
        approval.arguments,
        {
          inputResponses: responseInputs(approval.inputRequests, decision),
          requestState: approval.requestState,
        },
      );
      const normalized = executionResult(result);
      execution.status =
        result.resultType === "completed" ? "succeeded" : "failed";
      execution.result = normalized;
      execution.error =
        typeof normalized.error === "string" ? normalized.error : null;
      execution.providerLogId = result.logId || null;
      await execution.save();
      await audit({
        organizationId,
        eventType: decision === "deny" ? "tool_denied" : "tool_approved",
        toolSlug: approval.metaToolSlug,
        success: result.resultType === "completed",
        metadata: { approvalId, providerLogId: result.logId },
      });
      return normalized;
    } catch (error) {
      execution.status = "uncertain";
      execution.error = safeIntegrationError(error);
      execution.result = boundedResult({
        status: "uncertain",
        message:
          "The approval continuation outcome could not be confirmed and will not be repeated automatically.",
      });
      await execution.save();
      await audit({
        organizationId,
        eventType: "tool_approval_failed",
        toolSlug: approval.metaToolSlug,
        success: false,
        metadata: { approvalId, outcome: "uncertain" },
      });
      throw error;
    }
  }

  async executeAgentTool(
    organizationId: string,
    conversationId: string,
    input: {
      sessionId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    },
  ) {
    if (input.toolName === APPROVAL_TOOL_NAME) {
      return this.resolveApproval(
        organizationId,
        conversationId,
        input.sessionId,
        input.arguments,
      );
    }

    const session = await this.executionSession(
      organizationId,
      conversationId,
      input.sessionId,
    );
    if (!session.allowedMetaTools.includes(input.toolName)) {
      throw new AppError("Session tool is not authorized", 403);
    }
    const policy = await this.resolvedPolicy(organizationId);
    if (!policy || policy.hash !== session.policyHash) {
      await this.expireSession(session);
      throw new AppError(
        "Integration policy changed; start a new session",
        409,
      );
    }

    const canonical = canonicalizeArguments(input.arguments);
    const protocolError = validateSessionMetaCall({
      metaToolSlug: input.toolName,
      args: canonical.arguments,
      allowedMetaTools: session.allowedMetaTools,
      discoveredToolSlugs: session.discoveredToolSlugs ?? [],
      toolSchemas: session.toolSchemas ?? {},
      riskByTool: policy.riskByTool,
    });
    if (protocolError) {
      await audit({
        organizationId,
        eventType: "tool_rejected",
        toolSlug: input.toolName,
        success: false,
        metadata: {
          code: protocolError.code,
          argumentHash: canonical.hash,
        },
      });
      throw new AppError(
        protocolError.message,
        protocolError.statusCode,
        protocolError.code,
      );
    }
    const classification = classifyMetaExecution({
      metaToolSlug: input.toolName,
      args: canonical.arguments,
      riskByTool: policy.riskByTool,
    });
    if (!classification.allowed) {
      throw new AppError("Integration action is not allowed", 403);
    }
    if (
      input.toolName === "COMPOSIO_MULTI_EXECUTE_TOOL" &&
      classification.toolSlugs.length === 0
    ) {
      throw new AppError(
        "Composio multi-execute did not contain any recognizable tool slugs",
        400,
      );
    }
    if (input.toolName === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      const placeholder = findDependencyPlaceholder(canonical.arguments);
      if (placeholder) {
        throw new AppError(
          `Invalid dependency placeholder "${placeholder}". COMPOSIO_MULTI_EXECUTE_TOOL runs entries in parallel. Execute only the prerequisite read tool now, then make a separate meta-tool call using the literal ID or URL returned by that read.`,
          400,
          "DEPENDENT_TOOL_BATCH_NOT_ALLOWED",
        );
      }
    }
    const batchToolSlugs = classification.toolSlugs;
    const mutating = classification.mutating;

    const reserved = await IntegrationSession.findOneAndUpdate(
      {
        _id: session._id,
        status: "active",
        expiresAt: { $gt: new Date() },
        executionCount: { $lt: MAX_SESSION_EXECUTIONS },
      },
      { $inc: { executionCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true },
    );
    if (!reserved) {
      throw new AppError("Integration session execution limit reached", 429);
    }

    const executionKey = canonicalizeArguments({
      toolName: input.toolName,
      arguments: mutating
        ? mutationExecutionIdentity(canonical.arguments, policy.riskByTool)
        : canonical.arguments,
      ...(mutating ? {} : { nonce: randomUUID() }),
    }).hash;
    let execution;
    try {
      execution = await IntegrationExecution.create({
        organizationId,
        conversationId,
        sessionId: session._id,
        executionKey,
        metaToolSlug: input.toolName,
        argumentHash: canonical.hash,
        mutating,
        status: "running",
      });
    } catch (error: unknown) {
      if (!mutating || (error as { code?: number }).code !== 11000) throw error;
      const existing = await IntegrationExecution.findOne({
        sessionId: session._id,
        executionKey,
      });
      if (!existing) throw error;
      if (
        existing.status === "succeeded" ||
        existing.status === "approval_required"
      ) {
        await audit({
          organizationId,
          eventType: "tool_replay_blocked",
          toolSlug: input.toolName,
          success: true,
          metadata: { executionId: existing._id.toString() },
        });
        return existing.result;
      }
      if (existing.status === "failed") {
        execution = await IntegrationExecution.create({
          organizationId,
          conversationId,
          sessionId: session._id,
          executionKey: canonicalizeArguments({
            executionKey,
            retryId: randomUUID(),
          }).hash,
          metaToolSlug: input.toolName,
          argumentHash: canonical.hash,
          mutating,
          status: "running",
        });
      } else {
        throw new AppError(
          "This external mutation is already running or its outcome is uncertain, so it will not be repeated automatically",
          409,
          "DUPLICATE_MUTATION_BLOCKED",
        );
      }
    }

    await audit({
      organizationId,
      eventType: "tool_requested",
      toolSlug: input.toolName,
      success: true,
      metadata: {
        executionId: execution._id.toString(),
        argumentHash: canonical.hash,
        mutating,
        batchToolSlugs,
      },
    });

    try {
      const result = await composioAdapter.executeMeta(
        session.composioSessionId,
        input.toolName,
        canonical.arguments,
      );
      const normalized: Record<string, unknown> = {
        ...executionResult(result),
        phase: sessionMetaPhase(input.toolName),
        mutating,
        toolSlugs: batchToolSlugs,
      };
      execution.status =
        result.resultType === "completed"
          ? "succeeded"
          : mutating
            ? failedMutationOutcome({
                data: result.data,
                toolSlugs: batchToolSlugs,
                riskByTool: policy.riskByTool,
              })
            : "failed";
      if (execution.status === "uncertain") normalized.status = "uncertain";
      execution.result = normalized;
      execution.error =
        typeof normalized.error === "string" ? normalized.error : null;
      execution.providerLogId = result.logId || null;
      if (
        result.resultType === "completed" &&
        (input.toolName === COMPOSIO_SEARCH_TOOLS ||
          input.toolName === COMPOSIO_GET_TOOL_SCHEMAS)
      ) {
        const grounding = extractSessionToolGrounding(result.data);
        const authorizedSlugs = grounding.discoveredToolSlugs.filter((slug) =>
          policy.riskByTool.has(slug),
        );
        session.discoveredToolSlugs = [
          ...new Set([
            ...(session.discoveredToolSlugs ?? []),
            ...authorizedSlugs,
          ]),
        ].sort();
        const schemas = { ...(session.toolSchemas ?? {}) };
        for (const [slug, schema] of Object.entries(grounding.toolSchemas)) {
          if (policy.riskByTool.has(slug)) schemas[slug] = schema;
        }
        session.toolSchemas = schemas;
        session.markModified("toolSchemas");
        await session.save();
      }
      await execution.save();
      await audit({
        organizationId,
        eventType:
          result.resultType === "completed" ? "tool_executed" : "tool_failed",
        toolSlug: input.toolName,
        success: result.resultType === "completed",
        metadata: {
          executionId: execution._id.toString(),
          providerLogId: result.logId,
          outcome: execution.status,
        },
      });
      return normalized;
    } catch (error) {
      if (error instanceof ComposioToolInputRequiredError) {
        const approval = await IntegrationApproval.create({
          organizationId,
          conversationId,
          sessionId: session._id,
          executionId: execution._id,
          metaToolSlug: input.toolName,
          arguments: canonical.arguments,
          requestState: error.requestState,
          inputRequests: error.inputRequests,
          status: "pending",
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        });
        const normalized = boundedResult({
          status: "approval_required",
          approvalId: approval._id.toString(),
          questions: error.inputRequests,
          message:
            "The action was not executed. Ask the user to approve or deny it, then use the approval resolution tool on their next response.",
        });
        execution.status = "approval_required";
        execution.result = normalized;
        await execution.save();
        await audit({
          organizationId,
          eventType: "tool_approval_required",
          toolSlug: input.toolName,
          success: true,
          metadata: { approvalId: approval._id.toString() },
        });
        return normalized;
      }

      execution.status = mutating ? "uncertain" : "failed";
      execution.error = safeIntegrationError(error);
      await execution.save();
      await audit({
        organizationId,
        eventType: "tool_failed",
        toolSlug: input.toolName,
        success: false,
        metadata: {
          executionId: execution._id.toString(),
          outcome: execution.status,
        },
      });
      throw error;
    }
  }

  async catalog(
    organizationId: string,
    input: { page: number; limit: number; search?: string; category?: string },
  ) {
    const directory = composioAdapter.isAvailable()
      ? await composioAdapter.listToolkits()
      : [];
    const search = input.search?.trim().toLowerCase();
    const category = input.category?.trim().toLowerCase();
    const categoryTerms: Record<string, string[]> = {
      communication: ["communication", "email", "messaging", "calendar"],
      productivity: ["productivity", "collaboration", "office"],
      "crm & sales": ["crm", "sales", "marketing"],
      "project management": ["project", "task management"],
      engineering: ["engineering", "developer", "development"],
      "customer support": ["customer support", "support", "helpdesk"],
      knowledge: ["knowledge", "documentation", "documents"],
    };
    const requestedCategories = category
      ? categoryTerms[category] || [category]
      : [];
    const filtered = directory.filter((toolkit) => {
      const searchable =
        `${toolkit.name} ${toolkit.description} ${toolkit.category}`.toLowerCase();
      const matchesSearch = !search || searchable.includes(search);
      const toolkitCategory = toolkit.category.toLowerCase();
      const matchesCategory =
        requestedCategories.length === 0 ||
        requestedCategories.some((term) => toolkitCategory.includes(term));
      return matchesSearch && matchesCategory;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / input.limit));
    const resolvedPage = Math.min(input.page, totalPages);
    const start = (resolvedPage - 1) * input.limit;
    const policies = await IntegrationPolicy.find({ organizationId }).lean();
    const byToolkit = new Map(
      policies.map((policy) => [policy.toolkitSlug, policy]),
    );
    return {
      available: composioAdapter.isAvailable(),
      enabled: config.composio.enabled,
      toolkits: filtered.slice(start, start + input.limit).map((toolkit) => ({
        ...toolkit,
        policy: byToolkit.get(toolkit.slug) ?? {
          enabled: true,
          allowedTools: [],
        },
      })),
      pagination: {
        page: resolvedPage,
        limit: input.limit,
        total: filtered.length,
        totalPages,
      },
    };
  }

  private async resolvedToolkit(toolkitSlug: string): Promise<CatalogToolkit> {
    const [summary, remoteTools] = await Promise.all([
      composioAdapter.getToolkit(toolkitSlug),
      composioAdapter.listToolkitTools(toolkitSlug),
    ]);
    const tools = remoteTools.map(catalogToolFromComposio);
    return { ...summary, tools, toolsCount: tools.length };
  }

  async toolkit(organizationId: string, toolkitSlug: string) {
    const toolkit = await this.resolvedToolkit(toolkitSlug);
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
      allowedTools: Array<{ slug: string; risk: IntegrationToolRisk }>;
    },
  ) {
    const toolkit = await this.resolvedToolkit(toolkitSlug);
    const catalogBySlug = new Map(
      toolkit.tools.map((tool) => [tool.slug, tool]),
    );
    const unique = new Set<string>();
    for (const entry of input.allowedTools) {
      const catalogTool = catalogBySlug.get(entry.slug);
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
      { organizationId, toolkitSlug: toolkit.slug },
      {
        enabled: input.enabled,
        allowedTools: input.allowedTools,
        updatedBy: userId,
      },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    await this.closeOrganizationSessions(organizationId);
    await audit({
      organizationId,
      actorUserId: userId,
      eventType: "policy_updated",
      toolkitSlug: toolkit.slug,
      success: true,
      metadata: {
        enabled: input.enabled,
        toolCount: input.allowedTools.length,
      },
    });
    return policy;
  }

  async listConnections(organizationId: string) {
    const composioUserId = buildComposioUserId(organizationId);
    return IntegrationConnection.find({
      organizationId,
      composioUserId,
      status: { $ne: "disconnected" },
    })
      .select(
        "toolkitSlug connectedAccountId status displayLabel lastError createdBy createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .lean();
  }

  async connect(organizationId: string, userId: string, toolkitSlug: string) {
    const toolkit = await this.resolvedToolkit(toolkitSlug);
    let policy: any = await IntegrationPolicy.findOne({
      organizationId,
      toolkitSlug: toolkit.slug,
    }).lean();
    if (!policy) {
      policy = await IntegrationPolicy.create({
        organizationId,
        toolkitSlug: toolkit.slug,
        enabled: true,
        allowedTools: toolkit.tools
          .filter((tool) => tool.defaultEnabled)
          .map(({ slug, risk }) => ({ slug, risk })),
        updatedBy: userId,
      }).then((document) => document.toObject());
    }
    if (!policy.enabled || policy.allowedTools.length === 0) {
      throw new AppError(
        "This integration is disabled by workspace policy",
        403,
      );
    }

    const composioUserId = buildComposioUserId(organizationId);
    const authorization = await composioAdapter.createAuthorization({
      composioUserId,
      toolkitSlug: toolkit.slug,
      allowedToolSlugs: policy.allowedTools.map(
        (tool: { slug: string }) => tool.slug,
      ),
      callbackUrl: config.composio.redirectUrl,
    });
    const connection = await IntegrationConnection.findOneAndUpdate(
      {
        organizationId,
        toolkitSlug: toolkit.slug,
        connectedAccountId: authorization.connectedAccountId,
      },
      {
        createdBy: userId,
        composioUserId,
        composioSessionId: authorization.sessionId,
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
      toolkitSlug: toolkit.slug,
      success: true,
    });
    return {
      connectionId: connection._id,
      authorizationUrl: authorization.redirectUrl,
    };
  }

  async reconcile(organizationId: string, userId: string, toolkitSlug: string) {
    const composioUserId = buildComposioUserId(organizationId);
    const connection = await IntegrationConnection.findOne({
      organizationId,
      composioUserId,
      toolkitSlug,
      status: { $ne: "disconnected" },
    })
      .select("+composioUserId +composioSessionId")
      .sort({ createdAt: -1 });
    if (!connection) return null;
    try {
      const account = await composioAdapter.getOwnedAccount({
        composioUserId: connection.composioUserId,
        toolkitSlug,
        connectedAccountId: connection.connectedAccountId,
      });
      if (!account)
        throw new AppError("Connected account is not tenant-owned", 404);
      const nextStatus = statusFromComposio(account.status, account.isDisabled);
      const activated =
        connection.status !== "active" && nextStatus === "active";
      connection.status = nextStatus;
      connection.displayLabel = account.alias?.slice(0, 160) || null;
      connection.lastError =
        nextStatus === "error"
          ? (account.statusReason || "Connection failed").slice(0, 500)
          : null;
      if (activated && connection.composioSessionId) {
        await composioAdapter
          .deleteSession(connection.composioSessionId)
          .catch(() => undefined);
        connection.composioSessionId = null;
      }
      await connection.save();
      if (activated) {
        await audit({
          organizationId,
          actorUserId: userId,
          connectionId: connection._id,
          eventType: "connection_activated",
          toolkitSlug,
          success: true,
        });
      }
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
    delete result.composioSessionId;
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
    }).select("+composioUserId +composioSessionId");
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
      if (connection.composioSessionId) {
        await composioAdapter.deleteSession(connection.composioSessionId);
      }
    } catch {
      remoteRevoked = false;
      connection.lastError =
        "Local access was removed, but provider revocation could not be confirmed";
      await connection.save();
    }
    await this.closeOrganizationSessions(organizationId);
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
}
