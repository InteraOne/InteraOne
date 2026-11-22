import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalApiService } from "../src/infrastructure/api/internal-api.service";
import { getCustomActionTools } from "../src/modules/agents/tools/custom-action.tools";

const context = {
  organizationId: "507f1f77bcf86cd799439011",
  conversationId: "507f1f77bcf86cd799439012",
};

describe("custom action agent tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hides runtime tenant fields and executes through the internal gateway", async () => {
    vi.spyOn(InternalApiService, "getCustomActionTools").mockResolvedValue({
      status: "ready",
      tools: [{
        name: "custom_delete_agent",
        description: "Delete an agent",
        inputSchema: {
          type: "object",
          properties: { orgId: { type: "string" }, memberId: { type: "string" } },
          required: ["orgId", "memberId"],
          additionalProperties: false,
        },
      }],
    });
    const execute = vi.spyOn(InternalApiService, "executeCustomActionTool").mockResolvedValue({ status: "approval_required", executed: false, approvalId: "approval-1" });

    const resolution = await getCustomActionTools(context);
    expect(resolution.tools[0].inputSchema).toEqual({
      type: "object",
      properties: { memberId: { type: "string" } },
      required: ["memberId"],
      additionalProperties: false,
    });
    await resolution.tools[0].execute({ memberId: "membership-1" }, context);
    expect(execute).toHaveBeenCalledWith({
      ...context,
      toolName: "custom_delete_agent",
      arguments: { memberId: "membership-1" },
    });
  });

  it("exposes a pending approval resolver returned by the gateway", async () => {
    vi.spyOn(InternalApiService, "getCustomActionTools").mockResolvedValue({
      status: "ready",
      tools: [{
        name: "resolve_custom_action_approval",
        description: "Resolve pending approval approval-1",
        inputSchema: {
          type: "object",
          properties: { approvalId: { type: "string" }, decision: { type: "string", enum: ["approve", "deny"] } },
          required: ["approvalId", "decision"],
          additionalProperties: false,
        },
      }],
    });
    const execute = vi.spyOn(InternalApiService, "executeCustomActionTool").mockResolvedValue({ status: "succeeded", executed: true });

    const resolution = await getCustomActionTools(context);
    await resolution.tools[0].execute({ approvalId: "approval-1", decision: "approve" }, context);
    expect(execute).toHaveBeenCalledWith({
      ...context,
      toolName: "resolve_custom_action_approval",
      arguments: { approvalId: "approval-1", decision: "approve" },
    });
  });
});
