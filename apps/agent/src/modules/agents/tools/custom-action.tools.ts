import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import logger from "../../../shared/logger";
import { Tool, ToolExecutionContext, ToolExecutionError } from "../agent.types";

interface NativeCustomActionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CustomActionResolution {
  tools: Tool[];
  status: string;
  message: string;
}

function providerSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? { ...(schema.properties as Record<string, unknown>) }
    : {};
  delete properties.orgId;
  delete properties.organizationId;
  delete properties.conversationId;
  const hidden = new Set(["orgId", "organizationId", "conversationId"]);
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key) => typeof key === "string" && !hidden.has(key))
    : [];
  return { ...schema, properties, required };
}

function wrapTool(nativeTool: NativeCustomActionTool, organizationId: string, conversationId: string): Tool {
  const inputSchema = providerSchema(nativeTool.inputSchema);
  const properties = inputSchema.properties && typeof inputSchema.properties === "object"
    ? inputSchema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required as string[] : []);
  return {
    name: nativeTool.name,
    description: nativeTool.description,
    parameters: Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, { ...schema, required: required.has(name) }])),
    inputSchema,
    source: "custom_action",
    executionMode: "sequential",
    async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<unknown> {
      if (context?.organizationId !== organizationId || context?.conversationId !== conversationId) {
        throw new Error("Custom action context mismatch");
      }
      const cleanArgs = { ...args };
      delete cleanArgs.organizationId;
      delete cleanArgs.conversationId;
      try {
        const result = await InternalApiService.executeCustomActionTool({ organizationId, conversationId, toolName: nativeTool.name, arguments: cleanArgs });
        if (result?.status === "failed") throw new ToolExecutionError("Custom action execution failed", result);
        return result;
      } catch (error: any) {
        if (error instanceof ToolExecutionError) throw error;
        const message = error?.response?.data?.message || error?.message || "Custom action execution failed";
        throw new ToolExecutionError(message, { status: "failed", executed: false, code: error?.response?.data?.code || "CUSTOM_ACTION_REJECTED", error: message });
      }
    },
  };
}

export async function getCustomActionTools(input: { organizationId?: string; conversationId?: string }): Promise<CustomActionResolution> {
  if (!input.organizationId || !input.conversationId) return { tools: [], status: "missing_context", message: "Organization and conversation context are required" };
  try {
    const response = await InternalApiService.getCustomActionTools(input.organizationId, input.conversationId);
    if (!response || !Array.isArray(response.tools)) throw new Error("Gateway returned an invalid custom action response");
    return {
      tools: response.tools.map((tool: NativeCustomActionTool) => wrapTool(tool, input.organizationId!, input.conversationId!)),
      status: response.status || "ready",
      message: response.message || "Custom actions ready",
    };
  } catch (error: any) {
    const message = error?.response?.data?.message || error?.message || String(error);
    logger.error("Custom action setup failed", { organizationId: input.organizationId, conversationId: input.conversationId, error: message });
    return { tools: [], status: "failed", message };
  }
}

export function isCustomActionTool(tool: Tool): boolean {
  return tool.source === "custom_action";
}
