import { AppError } from "@shared/core/errors";
import { Conversation, CustomAction, CustomActionApproval, IntegrationAuditEvent } from "@shared/models";
import { encryptCredential } from "@shared/security/credential-cipher";
import { executeCustomAction } from "./custom-actions.executor";
import { validateActionInput, validateActionSchema } from "./custom-actions.validation";

type Payload = Record<string, any>;

export const CUSTOM_ACTION_APPROVAL_TOOL = "resolve_custom_action_approval";

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
  async agentTools(organizationId: string, conversationId: string) {
    const conversation = await Conversation.exists({ _id: conversationId, organizationId });
    if (!conversation) throw new AppError("Conversation not found", 404);

    await CustomActionApproval.updateMany(
      { organizationId, conversationId, status: "pending", expiresAt: { $lte: new Date() } },
      { $set: { status: "expired", resolvedAt: new Date() } },
    );
    const [actions, approvals] = await Promise.all([
      CustomAction.find({ organizationId, enabled: true }).sort({ name: 1 }).lean(),
      CustomActionApproval.find({ organizationId, conversationId, status: "pending" }).sort({ createdAt: 1 }).lean(),
    ]);

    const tools = actions.map((action) => ({
      name: `custom_${action.slug}`,
      description: `${action.description}${action.confirmation.mode === "always" ? " This action requires explicit user approval before it executes." : ""}`,
      inputSchema: action.inputSchema,
    }));
    if (approvals.length) {
      tools.push({
        name: CUSTOM_ACTION_APPROVAL_TOOL,
        description: `Resolve a pending custom-action approval only after the user explicitly approves or denies it in the current conversation. Pending requests: ${JSON.stringify(approvals.map((approval) => ({ approvalId: approval._id.toString(), action: approval.actionSlug, arguments: approval.arguments })))}`,
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
  ) {
    const conversation = await Conversation.exists({ _id: conversationId, organizationId });
    if (!conversation) throw new AppError("Conversation not found", 404);

    if (toolName === CUSTOM_ACTION_APPROVAL_TOOL) {
      const approval = await CustomActionApproval.findOne({
        _id: String(input.approvalId || ""), organizationId, conversationId,
      });
      if (!approval) throw new AppError("Custom action approval not found", 404);
      if (approval.status !== "pending") return { status: approval.status, executed: false };
      if (approval.expiresAt <= new Date()) {
        approval.status = "expired";
        approval.resolvedAt = new Date();
        await approval.save();
        return { status: "expired", executed: false };
      }
      if (input.decision === "deny") {
        approval.status = "denied";
        approval.resolvedAt = new Date();
        await approval.save();
        return { status: "denied", executed: false };
      }
      if (input.decision !== "approve") throw new AppError("Decision must be approve or deny", 400);
      const action = await CustomAction.findOne({ _id: approval.actionId, organizationId, enabled: true })
        .select("+authentication.encryptedCredentials");
      if (!action) throw new AppError("Custom action is no longer available", 404);
      const result = await executeCustomAction(action, approval.arguments);
      approval.status = "approved";
      approval.resolvedAt = new Date();
      await approval.save();
      await IntegrationAuditEvent.create({ organizationId, eventType: "custom_action_executed", toolSlug: action.slug, success: result.ok, metadata: { conversationId, approvalId: approval._id.toString(), status: result.status } });
      return { status: result.ok ? "succeeded" : "failed", executed: true, result };
    }

    const slug = toolName.startsWith("custom_") ? toolName.slice(7) : "";
    const action = await CustomAction.findOne({ organizationId, slug, enabled: true })
      .select("+authentication.encryptedCredentials");
    if (!action) throw new AppError("Custom action not found or disabled", 404);
    const args = runtimeArguments(action.inputSchema, input, organizationId, conversationId);
    validateActionInput(action.inputSchema, args);
    if (action.confirmation.mode === "always") {
      const existingApproval = await CustomActionApproval.findOne({
        organizationId,
        conversationId,
        actionId: action._id,
        status: "pending",
        expiresAt: { $gt: new Date() },
      });
      if (existingApproval) {
        return { status: "approval_required", executed: false, approvalId: existingApproval._id.toString(), action: action.name, arguments: existingApproval.arguments, message: "The action is already awaiting user approval. Ask the user to approve or deny it, then use the approval resolution tool on their next response." };
      }
      const approval = await CustomActionApproval.create({
        organizationId, conversationId, actionId: action._id, actionSlug: action.slug,
        arguments: args, status: "pending", expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      await IntegrationAuditEvent.create({ organizationId, eventType: "custom_action_approval_required", toolSlug: action.slug, success: true, metadata: { conversationId, approvalId: approval._id.toString() } });
      return { status: "approval_required", executed: false, approvalId: approval._id.toString(), action: action.name, arguments: args, message: "The action was not executed. Ask the user to approve or deny it, then use the approval resolution tool on their next response." };
    }
    const result = await executeCustomAction(action, args);
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
    const action = await CustomAction.create({
      ...actionUpdate(payload),
      organizationId,
      createdBy: userId,
      updatedBy: userId,
    });
    await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_created", toolSlug: action.slug, success: true, metadata: { actionId: action._id.toString() } });
    return publicAction(action);
  }

  async update(organizationId: string, userId: string, actionId: string, payload: Payload) {
    const existing = await CustomAction.findOne({ _id: actionId, organizationId }).select("+authentication.encryptedCredentials");
    if (!existing) return null;
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

  async test(organizationId: string, userId: string, actionId: string, input: Record<string, unknown>) {
    const action = await CustomAction.findOne({ _id: actionId, organizationId }).select("+authentication.encryptedCredentials");
    if (!action) throw new AppError("Custom action not found", 404);
    try {
      const result = await executeCustomAction(action, input);
      await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_tested", toolSlug: action.slug, success: result.ok, metadata: { actionId, status: result.status, durationMs: result.durationMs } });
      return result;
    } catch (error) {
      await IntegrationAuditEvent.create({ organizationId, actorUserId: userId, eventType: "custom_action_test_failed", toolSlug: action.slug, success: false, metadata: { actionId } });
      throw error;
    }
  }
}
