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
  grounding?: ComposioSchemaGrounding;
}

export interface ComposioSchemaGrounding {
  discoveredToolSlugs: string[];
  loadedSchemaSlugs: string[];
}

interface SessionSchemaState {
  discovered: Set<string>;
  loaded: Set<string>;
}

const SEARCH_TOOL = "COMPOSIO_SEARCH_TOOLS";
const SCHEMA_TOOL = "COMPOSIO_GET_TOOL_SCHEMAS";
const EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";

export function isComposioSessionTool(tool: Tool): boolean {
  return tool.source === "composio";
}

function metaToolPhase(toolName: string): "discovery" | "schema" | "execution" {
  if (toolName === SEARCH_TOOL) return "discovery";
  if (toolName === SCHEMA_TOOL) return "schema";
  return "execution";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function applicationToolSlugs(args: Record<string, unknown>): string[] {
  if (!Array.isArray(args.tools)) return [];
  const slugs = args.tools.flatMap((entry) => {
    const tool = recordValue(entry);
    const slug = tool?.tool_slug ?? tool?.toolSlug ?? tool?.slug;
    return typeof slug === "string" && !slug.startsWith("COMPOSIO_")
      ? [slug]
      : [];
  });
  return [...new Set(slugs)];
}

function updateSchemaState(state: SessionSchemaState, result: unknown): void {
  const envelope = recordValue(result);
  const data = recordValue(envelope?.data);
  if (!data) return;
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    const record = recordValue(entry);
    for (const slug of [
      ...stringValues(record?.primary_tool_slugs),
      ...stringValues(record?.related_tool_slugs),
    ]) {
      state.discovered.add(slug);
    }
  }
  const schemas = recordValue(data.tool_schemas);
  for (const [key, value] of Object.entries(schemas ?? {})) {
    const schema = recordValue(value);
    const slug = typeof schema?.tool_slug === "string" ? schema.tool_slug : key;
    if (!slug) continue;
    state.discovered.add(slug);
    if (schema?.hasFullSchema !== false && recordValue(schema?.input_schema)) {
      state.loaded.add(slug);
    }
  }
}

function wrapSessionTool(
  nativeTool: NativeComposioTool,
  sessionId: string,
  organizationId: string,
  conversationId: string,
  schemaState: SessionSchemaState,
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
    // Discovery, schema retrieval, and execution form an ordered protocol.
    // Preserve model call order even if it emits several meta-tools together.
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
      const schemaFetchAttempted = new Set<string>();
      const execute = (toolName: string, arguments_: Record<string, unknown>) =>
        InternalApiService.executeComposioSessionTool({
          organizationId,
          conversationId,
          sessionId,
          toolName,
          arguments: arguments_,
        });

      const loadSchemas = async (slugs: string[]): Promise<void> => {
        const pending = slugs.filter((slug) => !schemaFetchAttempted.has(slug));
        if (pending.length === 0) return;
        pending.forEach((slug) => schemaFetchAttempted.add(slug));
        let schemaResult;
        try {
          schemaResult = await execute(SCHEMA_TOOL, {
            tool_slugs: pending,
            include: ["input_schema"],
          });
        } catch (error: any) {
          const response = error?.response?.data;
          const message =
            response?.message ||
            error?.message ||
            "Composio schema retrieval failed";
          throw new ToolExecutionError(message, {
            status: "failed",
            phase: "schema",
            executed: false,
            retryable: error?.response?.status !== 403,
            code: response?.code || "COMPOSIO_SCHEMA_CALL_REJECTED",
            error: message,
          });
        }
        if (schemaResult?.status === "failed") {
          throw new ToolExecutionError(
            schemaResult.error || "Composio schema retrieval failed",
            schemaResult,
          );
        }
        updateSchemaState(schemaState, schemaResult);
      };

      try {
        const requestedSlugs =
          nativeTool.name === EXECUTE_TOOL
            ? applicationToolSlugs(cleanArgs)
            : [];
        const knownMissing = requestedSlugs.filter(
          (slug) => schemaState.discovered.has(slug) && !schemaState.loaded.has(slug),
        );
        await loadSchemas(knownMissing);

        let result;
        try {
          result = await execute(nativeTool.name, cleanArgs);
        } catch (error: any) {
          const response = error?.response?.data;
          if (
            nativeTool.name !== EXECUTE_TOOL ||
            response?.code !== "INTEGRATION_TOOL_SCHEMA_REQUIRED"
          ) {
            throw error;
          }
          // The gateway rejected this call before Composio application
          // execution, so one schema fetch and one retry cannot duplicate a
          // mutation. Both calls still pass through normal tenant policy.
          const missing = requestedSlugs.filter(
            (slug) =>
              !schemaState.loaded.has(slug) && !schemaFetchAttempted.has(slug),
          );
          if (missing.length === 0) throw error;
          await loadSchemas(missing);
          result = await execute(nativeTool.name, cleanArgs);
        }
        updateSchemaState(schemaState, result);
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
      grounding?: ComposioSchemaGrounding;
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
    const schemaState: SessionSchemaState = {
      discovered: new Set(response.grounding?.discoveredToolSlugs ?? []),
      loaded: new Set(response.grounding?.loadedSchemaSlugs ?? []),
    };
    return {
      tools: response.tools.map((tool) =>
        wrapSessionTool(
          tool,
          response.sessionId!,
          input.organizationId!,
          input.conversationId!,
          schemaState,
        ),
      ),
      status: response.status || "ready",
      message: response.message || "Composio session ready",
      sessionId: response.sessionId,
      grounding: response.grounding,
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
