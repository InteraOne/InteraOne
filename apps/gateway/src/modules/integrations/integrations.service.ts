import { randomUUID } from "crypto";
import { Types } from "mongoose";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import {
  IntegrationAuditEvent,
  IntegrationConnection,
  IntegrationPolicy,
  IntegrationToolApproval,
} from "@shared/models";
import { composioAdapter, buildComposioUserId } from "./composio.adapter";
import { getCatalogToolkit, getCatalogTool, INTEGRATION_CATALOG } from "./integrations.policy";
import { canonicalizeArguments, safeIntegrationError } from "./integrations.utils";

const APPROVAL_TTL_MS = 15 * 60 * 1000;

async function audit(input: {
  organizationId: string;
  actorUserId?: string;
  connectionId?: Types.ObjectId;
  approvalId?: Types.ObjectId;
  eventType: string;
  toolkitSlug?: string;
  toolSlug?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  await IntegrationAuditEvent.create({ ...input, metadata: input.metadata ?? {} });
}

function statusFromComposio(status: string, disabled: boolean) {
  if (disabled || status === "INACTIVE" || status === "REVOKED") return "disconnected" as const;
  if (status === "ACTIVE") return "active" as const;
  if (status === "EXPIRED") return "expired" as const;
  if (status === "FAILED") return "error" as const;
  return "pending" as const;
}

export class IntegrationsService {
  async catalog(organizationId: string) {
    const policies = await IntegrationPolicy.find({ organizationId }).lean();
    const byToolkit = new Map(policies.map((policy) => [policy.toolkitSlug, policy]));
    return {
      available: composioAdapter.isAvailable(),
      enabled: config.composio.enabled,
      toolkits: INTEGRATION_CATALOG.map((toolkit) => ({
        ...toolkit,
        policy: byToolkit.get(toolkit.slug) ?? {
          enabled: true,
          allowedTools: toolkit.tools.filter((tool) => tool.defaultEnabled).map(({ slug, risk }) => ({ slug, risk })),
        },
      })),
    };
  }

  async updatePolicy(organizationId: string, userId: string, toolkitSlug: string, input: { enabled: boolean; allowedTools: Array<{ slug: string; risk: "read" | "write" | "sensitive" }> }) {
    const toolkit = getCatalogToolkit(toolkitSlug);
    if (!toolkit) throw new AppError("Integration toolkit is not allowed", 404);
    const unique = new Set<string>();
    for (const entry of input.allowedTools) {
      const catalogTool = getCatalogTool(toolkitSlug, entry.slug);
      if (!catalogTool || catalogTool.risk !== entry.risk || unique.has(entry.slug)) {
        throw new AppError("Integration policy contains an invalid tool", 400);
      }
      unique.add(entry.slug);
    }
    const policy = await IntegrationPolicy.findOneAndUpdate(
      { organizationId, toolkitSlug },
      { enabled: input.enabled, allowedTools: input.allowedTools, updatedBy: userId },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    await audit({ organizationId, actorUserId: userId, eventType: "policy_updated", toolkitSlug, success: true, metadata: { enabled: input.enabled, toolCount: input.allowedTools.length } });
    return policy;
  }

  async listConnections(organizationId: string, userId: string) {
    return IntegrationConnection.find({ organizationId, createdBy: userId, status: { $ne: "disconnected" } })
      .select("toolkitSlug connectedAccountId status displayLabel lastError createdBy createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
  }

  async connect(organizationId: string, userId: string, toolkitSlug: string) {
    const toolkit = getCatalogToolkit(toolkitSlug);
    if (!toolkit) throw new AppError("Integration toolkit is not allowed", 404);
    let policy: any = await IntegrationPolicy.findOne({ organizationId, toolkitSlug }).lean();
    if (!policy) {
      policy = await IntegrationPolicy.create({
        organizationId,
        toolkitSlug,
        enabled: true,
        allowedTools: toolkit.tools.filter((tool) => tool.defaultEnabled).map(({ slug, risk }) => ({ slug, risk })),
        updatedBy: userId,
      }).then((document) => document.toObject());
    }
    if (!policy.enabled || policy.allowedTools.length === 0) throw new AppError("This integration is disabled by workspace policy", 403);

    const composioUserId = buildComposioUserId(organizationId, userId);
    const link = await composioAdapter.createConnectLink({
      composioUserId,
      toolkitSlug,
      allowedToolSlugs: policy.allowedTools.map((tool: { slug: string }) => tool.slug),
      callbackUrl: config.composio.redirectUrl,
    });
    const connection = await IntegrationConnection.findOneAndUpdate(
      { organizationId, createdBy: userId, toolkitSlug, connectedAccountId: link.connectedAccountId },
      { composioUserId, status: "pending", lastError: null, disconnectedAt: null },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "connection_started", toolkitSlug, success: true });
    return { connectionId: connection._id, authorizationUrl: link.redirectUrl };
  }

  async reconcile(organizationId: string, userId: string, toolkitSlug: string) {
    const connection = await IntegrationConnection.findOne({ organizationId, createdBy: userId, toolkitSlug, status: { $ne: "disconnected" } })
      .select("+composioUserId")
      .sort({ createdAt: -1 });
    if (!connection) return null;
    try {
      const account = await composioAdapter.getOwnedAccount({ composioUserId: connection.composioUserId, toolkitSlug, connectedAccountId: connection.connectedAccountId });
      if (!account) throw new AppError("Connected account does not belong to this user", 404);
      const nextStatus = statusFromComposio(account.status, account.isDisabled);
      const activated = connection.status !== "active" && nextStatus === "active";
      connection.status = nextStatus;
      connection.displayLabel = account.alias?.slice(0, 160) || null;
      connection.lastError = nextStatus === "error" ? (account.statusReason || "Connection failed").slice(0, 500) : null;
      await connection.save();
      if (activated) await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "connection_activated", toolkitSlug, success: true });
    } catch (error) {
      connection.status = "error";
      connection.lastError = safeIntegrationError(error);
      await connection.save();
      await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "connection_failed", toolkitSlug, success: false });
    }
    const result = connection.toObject() as unknown as Record<string, unknown>;
    delete result.composioUserId;
    return result;
  }

  async disconnect(organizationId: string, userId: string, connectionId: string) {
    const connection = await IntegrationConnection.findOne({ _id: connectionId, organizationId, createdBy: userId }).select("+composioUserId");
    if (!connection) throw new AppError("Integration connection not found", 404);
    connection.status = "disconnected";
    connection.disconnectedAt = new Date();
    await connection.save();
    let remoteRevoked = true;
    try {
      const owned = await composioAdapter.getOwnedAccount({ composioUserId: connection.composioUserId, toolkitSlug: connection.toolkitSlug, connectedAccountId: connection.connectedAccountId });
      if (owned) await composioAdapter.disconnect(connection.connectedAccountId);
    } catch {
      remoteRevoked = false;
      connection.lastError = "Local access was removed, but provider revocation could not be confirmed";
      await connection.save();
    }
    await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "disconnected", toolkitSlug: connection.toolkitSlug, success: remoteRevoked, metadata: { remoteRevoked } });
    return { disconnected: true, remoteRevoked };
  }

  private async executionContext(organizationId: string, userId: string, connectionId: string, toolSlug: string) {
    const connection = await IntegrationConnection.findOne({ _id: connectionId, organizationId, createdBy: userId, status: "active" }).select("+composioUserId");
    if (!connection) throw new AppError("Active integration connection not found", 404);
    const policy = await IntegrationPolicy.findOne({ organizationId, toolkitSlug: connection.toolkitSlug, enabled: true }).lean();
    const policyTool = policy?.allowedTools.find((tool) => tool.slug === toolSlug);
    const catalogTool = getCatalogTool(connection.toolkitSlug, toolSlug);
    if (!policyTool || !catalogTool || policyTool.risk !== catalogTool.risk) throw new AppError("Integration action is not allowed", 403);
    const owned = await composioAdapter.getOwnedAccount({ composioUserId: connection.composioUserId, toolkitSlug: connection.toolkitSlug, connectedAccountId: connection.connectedAccountId });
    if (!owned || owned.status !== "ACTIVE" || owned.isDisabled) throw new AppError("Integration connection is no longer active", 409);
    return { connection, catalogTool };
  }

  async requestExecution(organizationId: string, userId: string, input: { connectionId: string; toolSlug: string; arguments: Record<string, unknown> }) {
    const { connection, catalogTool } = await this.executionContext(organizationId, userId, input.connectionId, input.toolSlug);
    const canonical = canonicalizeArguments(input.arguments);
    await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "tool_requested", toolkitSlug: connection.toolkitSlug, toolSlug: input.toolSlug, success: true, metadata: { argumentHash: canonical.hash } });
    if (catalogTool.risk === "read") {
      try {
        const result = await composioAdapter.execute({ composioUserId: connection.composioUserId, toolkitSlug: connection.toolkitSlug, connectedAccountId: connection.connectedAccountId, toolSlug: input.toolSlug, arguments: canonical.arguments });
        await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "tool_executed", toolkitSlug: connection.toolkitSlug, toolSlug: input.toolSlug, success: true, metadata: { argumentHash: canonical.hash } });
        return { approvalRequired: false, result };
      } catch (error) {
        await audit({ organizationId, actorUserId: userId, connectionId: connection._id, eventType: "tool_failed", toolkitSlug: connection.toolkitSlug, toolSlug: input.toolSlug, success: false, metadata: { argumentHash: canonical.hash } });
        throw error;
      }
    }
    const approval = await IntegrationToolApproval.create({
      organizationId,
      requestedBy: userId,
      connectionId: connection._id,
      toolkitSlug: connection.toolkitSlug,
      toolSlug: input.toolSlug,
      risk: catalogTool.risk,
      arguments: canonical.arguments,
      argumentHash: canonical.hash,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      idempotencyKey: randomUUID(),
    });
    await audit({ organizationId, actorUserId: userId, connectionId: connection._id, approvalId: approval._id, eventType: "approval_requested", toolkitSlug: connection.toolkitSlug, toolSlug: input.toolSlug, success: true, metadata: { argumentHash: canonical.hash } });
    return { approvalRequired: true, approval: approval.toObject() };
  }

  async listApprovals(organizationId: string) {
    await IntegrationToolApproval.updateMany({ organizationId, status: "pending", expiresAt: { $lte: new Date() } }, { status: "expired" });
    return IntegrationToolApproval.find({ organizationId }).populate("requestedBy", "name email").populate("approvedBy", "name email").sort({ createdAt: -1 }).limit(100).lean();
  }

  async rejectApproval(organizationId: string, approverId: string, approvalId: string) {
    const approval = await IntegrationToolApproval.findOneAndUpdate(
      { _id: approvalId, organizationId, status: "pending", expiresAt: { $gt: new Date() } },
      { status: "rejected", approvedBy: approverId, decidedAt: new Date() },
      { new: true },
    );
    if (!approval) throw new AppError("Approval is expired, already decided, or not found", 409);
    await audit({ organizationId, actorUserId: approverId, connectionId: approval.connectionId, approvalId: approval._id, eventType: "rejected", toolkitSlug: approval.toolkitSlug, toolSlug: approval.toolSlug, success: true });
    return approval;
  }

  async approveAndExecute(organizationId: string, approverId: string, approvalId: string) {
    const approval = await IntegrationToolApproval.findOneAndUpdate(
      { _id: approvalId, organizationId, status: "pending", expiresAt: { $gt: new Date() } },
      { status: "executing", approvedBy: approverId, decidedAt: new Date() },
      { new: true },
    );
    if (!approval) throw new AppError("Approval is expired, already decided, or not found", 409);
    await audit({ organizationId, actorUserId: approverId, connectionId: approval.connectionId, approvalId: approval._id, eventType: "approved", toolkitSlug: approval.toolkitSlug, toolSlug: approval.toolSlug, success: true, metadata: { argumentHash: approval.argumentHash } });
    try {
      const requestedBy = approval.requestedBy.toString();
      const { connection } = await this.executionContext(organizationId, requestedBy, approval.connectionId.toString(), approval.toolSlug);
      const canonical = canonicalizeArguments(approval.arguments);
      if (canonical.hash !== approval.argumentHash) throw new AppError("Approval arguments no longer match", 409);
      const result = await composioAdapter.execute({ composioUserId: connection.composioUserId, toolkitSlug: approval.toolkitSlug, connectedAccountId: connection.connectedAccountId, toolSlug: approval.toolSlug, arguments: canonical.arguments });
      approval.status = "executed";
      approval.executedAt = new Date();
      approval.resultSummary = { completed: true };
      await approval.save();
      await audit({ organizationId, actorUserId: approverId, connectionId: approval.connectionId, approvalId: approval._id, eventType: "tool_executed", toolkitSlug: approval.toolkitSlug, toolSlug: approval.toolSlug, success: true, metadata: { argumentHash: approval.argumentHash } });
      return { approval: approval.toObject(), result };
    } catch (error) {
      approval.status = "failed";
      approval.error = safeIntegrationError(error);
      await approval.save();
      await audit({ organizationId, actorUserId: approverId, connectionId: approval.connectionId, approvalId: approval._id, eventType: "tool_failed", toolkitSlug: approval.toolkitSlug, toolSlug: approval.toolSlug, success: false, metadata: { argumentHash: approval.argumentHash } });
      throw error;
    }
  }
}
