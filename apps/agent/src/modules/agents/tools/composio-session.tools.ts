import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import logger from "../../../shared/logger";
import { Tool, ToolExecutionContext, ToolExecutionError } from "../agent.types";

interface NativeComposioTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ComposioSessionResolution {
  tools: Tool[];
  status: string;
  message: string;
  sessionId?: string;
}

const SEARCH_TOOL = "COMPOSIO_SEARCH_TOOLS";
const SCHEMA_TOOL = "COMPOSIO_GET_TOOL_SCHEMAS";

export function isComposioSessionTool(tool: Tool): boolean {
  return tool.source === "composio";
}

function metaToolPhase(toolName: string): "discovery" | "schema" | "execution" {
  if (toolName === SEARCH_TOOL) return "discovery";
  if (toolName === SCHEMA_TOOL) return "schema";
  return "execution";
}

function wrapSessionTool(
  nativeTool: NativeComposioTool,
  sessionId: string,
  organizationId: string,
  conversationId: string,
): Tool {
  const properties =
    nativeTool.inputSchema.properties &&
    typeof nativeTool.inputSchema.properties === "object" &&
    !Array.isArray(nativeTool.inputSchema.properties)
      ? (nativeTool.inputSchema.properties as Record<
          string,
          Record<string, unknown>
        >)
      : {};
  const required = new Set(
    Array.isArray(nativeTool.inputSchema.required)
      ? nativeTool.inputSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );

  return {
    name: nativeTool.name,
    description: nativeTool.description,
    parameters: Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        { ...schema, required: required.has(name) },
      ]),
    ),
    inputSchema: nativeTool.inputSchema,
    source: "composio",
    // Session meta-tools share state, so preserve their call order.
    executionMode: "sequential",
    async execute(
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      if (
        context?.organizationId !== organizationId ||
        context?.conversationId !== conversationId
      ) {
        throw new Error("Composio session context mismatch");
      }
      const cleanArgs = { ...args };
      delete cleanArgs.organizationId;
      delete cleanArgs.conversationId;
      try {
        const result = await InternalApiService.executeComposioSessionTool({
          organizationId,
          conversationId,
          sessionId,
          toolName: nativeTool.name,
          arguments: cleanArgs,
        });
        if (result?.status === "failed") {
          throw new ToolExecutionError(
            result.error || "Composio tool execution failed",
            result,
          );
        }
        if (result?.status === "uncertain") {
          throw new ToolExecutionError(
            result.error ||
              "The Composio mutation outcome is uncertain and must not be retried automatically",
            result,
          );
        }
        return result;
      } catch (error: any) {
        if (error instanceof ToolExecutionError) throw error;
        const response = error?.response?.data;
        const message =
          response?.message ||
          error?.message ||
          "Composio session tool execution failed";
        throw new ToolExecutionError(message, {
          status: "failed",
          phase: metaToolPhase(nativeTool.name),
          executed: false,
          retryable: error?.response?.status !== 403,
          code: response?.code || "COMPOSIO_SESSION_CALL_REJECTED",
          error: message,
        });
      }
    },
  };
}

export async function getComposioSessionTools(input: {
  organizationId?: string;
  conversationId?: string;
  channel: "widget" | "email" | "whatsapp" | "telegram";
}): Promise<ComposioSessionResolution> {
  if (!input.organizationId || !input.conversationId) {
    return {
      tools: [],
      status: "missing_context",
      message: "Organization and conversation context are required",
    };
  }
  try {
    const response = (await InternalApiService.openComposioSession(
      input.organizationId,
      input.conversationId,
      input.channel,
    )) as {
      status?: string;
      message?: string;
      sessionId?: string;
      tools?: NativeComposioTool[];
    };
    if (!response || !Array.isArray(response.tools)) {
      throw new Error("Gateway returned an invalid Composio session response");
    }
    if (!response.sessionId || response.tools.length === 0) {
      return {
        tools: [],
        status: response.status || "unavailable",
        message: response.message || "No Composio session tools are available",
      };
    }
    return {
      tools: response.tools.map((tool) =>
        wrapSessionTool(
          tool,
          response.sessionId!,
          input.organizationId!,
          input.conversationId!,
        ),
      ),
      status: response.status || "ready",
      message: response.message || "Composio session ready",
      sessionId: response.sessionId,
    };
  } catch (error: any) {
    const message =
      error?.response?.data?.message || error?.message || String(error);
    logger.error("Composio session setup failed", {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      error: message,
    });
    return { tools: [], status: "session_failed", message };
  }
}
