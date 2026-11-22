import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "@shared/core/errors";
import { Conversation, CustomAction, CustomActionApproval, IntegrationAuditEvent, Message, ICustomAction } from "@shared/models";
import { CustomActionIntegration } from "@shared/models/CustomActionIntegration";
import { parseActionSpec } from "./custom-actions.import";
import { encryptCredential } from "@shared/security/credential-cipher";
import { executeCustomAction } from "./custom-actions.executor";
import { validateActionInput, validateActionSchema } from "./custom-actions.validation";

type Payload = Record<string, any>;

export const CUSTOM_ACTION_APPROVAL_TOOL = "resolve_custom_action_approval";

function needsConfirmation(action: { request: { method: string }; confirmation: { mode: string } }) {
  return ("audience" in action && action.audience === "verified") || action.request.method !== "GET" || action.confirmation.mode === "always";
}

function verifiedEmail(metadata: Record<string, any> | undefined): string | undefined {
  const verification = metadata?.identityVerification;
  const age = Date.now() - new Date(verification?.verifiedAt ?? "").getTime();
  if (age >= 0 && age < 30 * 60_000 && !verification?.codeHash && typeof verification?.email === "string") return verification.email;
}

function stableInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableInput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stableInput(child)]));
}

function runtimeArguments(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
  organizationId: string,
  conversationId: string,
): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {};
  return {
    ...input,
    ...(properties.orgId ? { orgId: organizationId } : {}),
    ...(properties.organizationId ? { organizationId } : {}),
    ...(properties.conversationId ? { conversationId } : {}),
  };
}

function credentialHint(credentials: Record<string, unknown>): string | undefined {
  const secret = [credentials.token, credentials.value, credentials.password].find((value) => typeof value === "string") as string | undefined;
  return secret ? `••••${secret.slice(-4)}` : undefined;
}

function validateAuthentication(auth: Payload, existingConfigured = false): void {
  if (auth.type === "none") return;
  if (auth.type === "api_key" && !auth.keyName) throw new AppError("API key authentication requires keyName", 400);
  if (!auth.credentials && !existingConfigured) throw new AppError("Authentication credentials are required", 400);
  if (!auth.credentials) return;
  if (auth.type === "bearer" && typeof auth.credentials.token !== "string") throw new AppError("Bearer authentication requires a token", 400);
  if (auth.type === "basic" && (typeof auth.credentials.username !== "string" || typeof auth.credentials.password !== "string")) throw new AppError("Basic authentication requires username and password", 400);
  if (auth.type === "api_key" && typeof auth.credentials.value !== "string") throw new AppError("API key authentication requires a value", 400);
}

function actionUpdate(payload: Payload, existingConfigured = false): Payload {
  if (payload.inputSchema) validateActionSchema(payload.inputSchema);
  const result = { ...payload };
  if (payload.authentication) {
    validateAuthentication(payload.authentication, existingConfigured);
    const { credentials, ...safeAuth } = payload.authentication;
    result.authentication = {
      ...safeAuth,
      ...(credentials ? {
        encryptedCredentials: encryptCredential(JSON.stringify(credentials)),
        credentialHint: credentialHint(credentials),
      } : {}),
      ...(safeAuth.type === "none" ? { encryptedCredentials: undefined, credentialHint: undefined } : {}),
    };
  }
  return result;
}

function publicAction(action: any) {
  const value = typeof action.toObject === "function" ? action.toObject() : { ...action };
  if (value.authentication) delete value.authentication.encryptedCredentials;
  return value;
}

export class CustomActionsService {
  async importSpec(organizationId: string, userId: string, payload: Payload) {
    const { origin, actions, skipped } = parseActionSpec(payload.specification, payload.baseUrl);
    if (!actions.length) return { count: 0, skipped };
    const { authentication } = actionUpdate({ authentication: payload.authentication });
    const integration = await CustomActionIntegration.create({ organizationId, origin, authentication });
    const suffix = randomBytes(5).toString("hex");
    await CustomAction.insertMany(actions.map((action) => ({
      ...action,
      slug: `${action.slug}_${suffix}`,
      enabled: false,
      organizationId,
      integrationId: integration._id,
      authentication: { type: "none" },
      createdBy: userId,
      updatedBy: userId,
    })));
    return { count: actions.length, skipped };
  }

  private async run(action: ICustomAction, input: Record<string, unknown>, email?: string) {
    if (!action.integrationId) return executeCustomAction(action, input);
    const integration = await CustomActionIntegration.findOne({
      _id: action.integrationId, organizationId: action.organizationId,
    }).select("+authentication").lean();
    if (!integration) throw new AppError("Action integration is unavailable", 400);
    if (email && integration.authentication.type === "none") throw new AppError("Verified actions require integration authentication", 400);
    return executeCustomAction({ ...action.toObject(), authentication: integration.authentication }, input, integration.origin, email);
  }

  async agentTools(organizationId: string, conversationId: string) {
    const conversation = await Conversation.findOne({ _id: conversationId, organizationId }).select("metadata").lean();
    if (!conversation) throw new AppError("Conversation not found", 404);

    await CustomActionApproval.updateMany(
      { organizationId, conversationId, status: "pending", expiresAt: { $lte: new Date() } },
      { $set: { status: "expired", resolvedAt: new Date() } },
    );
    const [actions, approvals] = await Promise.all([
      CustomAction.find({ organizationId, enabled: true, audience: { $in: verifiedEmail(conversation.metadata) ? ["public", "verified"] : ["public"] } }).sort({ name: 1 }).lean(),
      CustomActionApproval.find({ organizationId, conversationId, status: "pending" }).sort({ createdAt: 1 }).lean(),
    ]);

    const tools = actions.map((action) => ({
      name: `custom_${action.slug}`,
      description: `${action.description}${needsConfirmation(action) ? " This action requires explicit user approval before it executes." : ""}`,
      inputSchema: action.inputSchema,
    }));
    if (approvals.length) {
      tools.push({
        name: CUSTOM_ACTION_APPROVAL_TOOL,
        description: `Resolve a pending approval after the visitor submits its exact confirmation command. Pending requests: ${JSON.stringify(approvals.map((approval) => ({ approvalId: approval._id.toString(), action: approval.actionSlug })))}`,
        inputSchema: {
          type: "object",
          properties: {
            approvalId: { type: "string", description: "Exact pending approval ID from this tool description" },
            decision: { type: "string", enum: ["approve", "deny"] },
          },
          required: ["approvalId", "decision"],
          additionalProperties: false,
        },
      } as any);
    }
    return { status: tools.length ? "ready" : "empty", message: tools.length ? "Custom actions are ready" : "No enabled custom actions", tools };
  }

  async executeAgentTool(
    organizationId: string,
    conversationId: string,
    toolName: string,
    input: Record<string, unknown>,
    messageId?: string,
  ) {
    const conversation = await Conversation.findOne({ _id: conversationId, organizationId }).select("metadata").lean();
    if (!conversation) throw new AppError("Conversation not found", 404);
    const email = verifiedEmail(conversation.metadata);
    const audience = { $in: email ? ["public", "verified"] : ["public"] };

    if (toolName === CUSTOM_ACTION_APPROVAL_TOOL) {
      const approval = await CustomActionApproval.findOne({
        _id: String(input.approvalId || ""), organizationId, conversationId,
      });
      if (!approval) throw new AppError("Custom action approval not found", 404);
      if (approval.status !== "pending") return { status: approval.status, executed: false };
      if (approval.expiresAt <= new Date()) {
        return { status: "expired", executed: false };
      }
      if (input.decision !== "approve" && input.decision !== "deny") throw new AppError("Decision must be approve or deny", 400);
      const command = `${input.decision} ${approval._id}`;
      const message = messageId && await Message.findOne({
        _id: messageId, organizationId, conversationId, type: "text",
        createdAt: { $gt: approval.createdAt },
        "metadata.source": { $in: ["widget", "email_channel", "whatsapp_channel", "telegram_channel"] },
      }).select("content").lean();
      if (!message || message.content.trim().toLowerCase() !== command) {
        return { status: "approval_required", executed: false, message: `Ask the visitor to reply exactly: ${command}` };
      }
      const action = await CustomAction.findOne({ _id: approval.actionId, organizationId, enabled: true, audience })
        .select("+authentication.encryptedCredentials");
      if (!action || action.updatedAt.getTime() !== approval.actionVersion?.getTime()) throw new AppError("Custom action changed or is no longer available", 409);
      if (action.audience === "verified" && email !== approval.requesterEmail) throw new AppError("Requester verification changed", 403);
      const status = input.decision === "deny" ? "denied" : "approved";
      const claim = await CustomActionApproval.updateOne(
        { _id: approval._id, status: "pending", expiresAt: { $gt: new Date() } },
        { $set: { status, resolvedAt: new Date() } },
      );
      if (!claim.modifiedCount || status === "denied") return { status: claim.modifiedCount ? "denied" : "already_resolved", executed: false };
      const result = await this.run(action, approval.arguments, approval.requesterEmail).catch(() => null);
      if (!result) {
        await IntegrationAuditEvent.create({ organizationId, eventType: "custom_action_uncertain", toolSlug: action.slug, success: false, metadata: { conversationId, approvalId: approval._id.toString() } });
        return { status: "uncertain", message: "The outcome could not be verified. Do not retry automatically." };
      }
      await IntegrationAuditEvent.create({ organizationId, eventType: "custom_action_executed", toolSlug: action.slug, success: result.ok, metadata: { conversationId, approvalId: approval._id.toString(), status: result.status } });
      return { status: result.ok ? "succeeded" : "failed", executed: true, result };
    }

    const slug = toolName.startsWith("custom_") ? toolName.slice(7) : "";
    const action = await CustomAction.findOne({ organizationId, slug, enabled: true, audience })
      .select("+authentication.encryptedCredentials");
    if (!action) throw new AppError("Custom action not found or disabled", 404);
    const args = runtimeArguments(action.inputSchema, input, organizationId, conversationId);
    validateActionInput(action.inputSchema, args);
    if (needsConfirmation(action)) {
      const fingerprint = JSON.stringify([organizationId, conversationId, action.id, stableInput(args)]);
      const id = new Types.ObjectId(createHash("sha256").update(fingerprint).digest("hex").slice(0, 24));
      const approval = await CustomActionApproval.findOneAndUpdate({ _id: id }, {
        $setOnInsert: {
          organizationId, conversationId, actionId: action._id, actionSlug: action.slug,
          actionVersion: action.updatedAt, arguments: args, status: "pending",
          requesterEmail: action.audience === "verified" ? email : undefined,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      }, { upsert: true, new: true });
      if (approval.status !== "pending" || approval.expiresAt <= new Date()) {
        return { status: "already_requested", executed: false, message: "This request already has a recorded attempt. Verify its outcome before requesting it again." };
      }
      return {
        status: "approval_required", executed: false, approvalId: id.toString(),
        action: action.name, arguments: args,
        message: `Summarize the action and ask the visitor to reply exactly: approve ${id} or deny ${id}`,
      };
    }
    const result = await this.run(action, args);
    await IntegrationAuditEvent.create({ organizationId, eventType: "custom_action_executed", toolSlug: action.slug, success: result.ok, metadata: { conversationId, status: result.status } });
    return { status: result.ok ? "succeeded" : "failed", executed: true, result };
  }

  async list(organizationId: string) {
    return CustomAction.find({ organizationId }).sort({ name: 1 }).lean();
  }

  async get(organizationId: string, actionId: string) {
    return CustomAction.findOne({ _id: actionId, organizationId }).lean();
  }

  async create(organizationId: string, userId: string, payload: Payload) {
    if (payload.audience === "verified") throw new AppError("Verified actions require an authenticated imported integration", 400);
    const action = await CustomAction.create({
      ...actionUpdate(payload),
      organizationId,
      createdBy: userId,
      updatedBy: userId,
    });
    await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_created", toolSlug: action.slug, success: true, metadata: { actionId: action._id.toString() } });
    return publicAction(action);
  }

  async bulkStatus(organizationId: string, userId: string, actionIds: string[], enabled: boolean) {
    const result = await CustomAction.updateMany(
      { _id: { $in: actionIds }, organizationId },
      { $set: { enabled, updatedBy: userId } },
    );
    await IntegrationAuditEvent.create({
      organizationId,
      actorUserId: userId,
      eventType: "custom_actions_bulk_status_updated",
      success: true,
      metadata: { requestedCount: actionIds.length, updatedCount: result.modifiedCount, enabled },
    });
    return { count: result.modifiedCount, enabled };
  }

  async bulkRemove(organizationId: string, userId: string, actionIds: string[]) {
    const result = await CustomAction.deleteMany({ _id: { $in: actionIds }, organizationId });
    await IntegrationAuditEvent.create({
      organizationId,
      actorUserId: userId,
      eventType: "custom_actions_bulk_deleted",
      success: true,
      metadata: { requestedCount: actionIds.length, deletedCount: result.deletedCount },
    });
    return { count: result.deletedCount };
  }

  async update(organizationId: string, userId: string, actionId: string, payload: Payload) {
    const existing = await CustomAction.findOne({ _id: actionId, organizationId }).select("+authentication.encryptedCredentials");
    if (!existing) return null;
    if (payload.audience === "verified") {
      const integration = await CustomActionIntegration.findOne({
        _id: existing.integrationId, organizationId,
      }).select("+authentication").lean();
      if (!integration || integration.authentication.type === "none") throw new AppError("Verified actions require an authenticated imported integration", 400);
    }
    if (existing.integrationId) delete payload.authentication;
    const update = actionUpdate(payload, Boolean(existing.authentication.encryptedCredentials));
    const action = await CustomAction.findOneAndUpdate(
      { _id: actionId, organizationId },
      { $set: { ...update, updatedBy: userId } },
      { new: true, runValidators: true },
    ).lean();
    await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_updated", toolSlug: action?.slug, success: true, metadata: { actionId } });
    return action;
  }

  async remove(organizationId: string, userId: string, actionId: string) {
    const action = await CustomAction.findOneAndDelete({ _id: actionId, organizationId });
    if (!action) return null;
    await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_deleted", toolSlug: action.slug, success: true, metadata: { actionId } });
    return action;
  }

  async test(organizationId: string, userId: string, actionId: string, input: Record<string, unknown>, requesterEmail?: string) {
    const action = await CustomAction.findOne({ _id: actionId, organizationId }).select("+authentication.encryptedCredentials");
    if (!action) throw new AppError("Custom action not found", 404);
    try {
      const result = await this.run(action, input, action.audience === "verified" ? requesterEmail : undefined);
      await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_tested", toolSlug: action.slug, success: result.ok, metadata: { actionId, status: result.status, durationMs: result.durationMs } });
      return result;
    } catch (error) {
      await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_test_failed", toolSlug: action.slug, success: false, metadata: { actionId } });
      throw error;
    }
  }
}
