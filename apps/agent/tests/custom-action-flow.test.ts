import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalApiService } from "../src/infrastructure/api/internal-api.service";
import { getCustomActionTools } from "../src/modules/agents/tools/custom-action.tools";
import { executeToolBatch } from "../src/modules/agents/tool-loop";

const context = {
  organizationId: "507f1f77bcf86cd799439011",
  conversationId: "507f1f77bcf86cd799439012",
};

describe("custom action agent tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defers a dependent mutation emitted before the read result", async () => {
    const read = vi.fn().mockResolvedValue({ status: "succeeded", id: "order-1" });
    const cancel = vi.fn();
    const tools = [
      { name: "custom_get_order", execute: read },
      { name: "custom_cancel_order", execute: cancel },
    ].map(tool => ({ ...tool, description: tool.name, parameters: {}, source: "custom_action" as const, executionMode: "sequential" as const }));
    const outcomes = await executeToolBatch({
      tools,
      context,
      calls: [
        { id: "read", name: tools[0].name, input: {} },
        { id: "cancel", name: tools[1].name, input: { id: "guessed" } },
      ],
    });
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(outcomes[1].step.result).toMatchObject({ status: "deferred", executed: false });
  });

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
