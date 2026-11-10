import { createHash } from "crypto";
import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import logger from "../../../shared/logger";
import {
  Tool,
  ToolExecutionContext,
  ToolParameterSchema,
} from "../agent.types";

interface DiscoveredComposioTool {
  name: string;
  displayName?: string;
  description: string;
  parameters?: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  connectionId: string;
  toolkitSlug: string;
  risk: "read" | "write" | "sensitive";
}

interface CacheEntry {
  expiresAt: number;
  tools: Tool[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = parseInt(
  process.env.COMPOSIO_TOOL_CACHE_TTL_MS || "30000",
  10,
);

function modelSafeName(slug: string): string {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(slug)) return slug;
  const digest = createHash("sha256").update(slug).digest("hex").slice(0, 24);
  return `composio_${digest}`;
}

function toParameters(
  schema: DiscoveredComposioTool["parameters"],
): Record<string, ToolParameterSchema> {
  const required = new Set(schema?.required || []);
  const properties = schema?.properties || {};

  return Object.fromEntries(
    Object.entries(properties).map(([name, definition]) => {
      const parameter = {
        ...definition,
        required: required.has(name),
      } as ToolParameterSchema;
      if (
        !parameter.type &&
        !parameter.anyOf &&
        !parameter.oneOf &&
        !parameter.allOf
      ) {
        parameter.type = "string";
      }
      return [name, parameter];
    }),
  );
}

function wrapComposioTool(
  discovered: DiscoveredComposioTool,
  organizationId: string,
): Tool {
  const approvalNote =
    discovered.risk === "read"
      ? ""
      : " This action requires workspace approval before Composio executes it.";

  return {
    name: modelSafeName(discovered.name),
    description: `[Connected ${discovered.toolkitSlug} tool: ${discovered.name}] ${discovered.description}${approvalNote}`,
    parameters: toParameters(discovered.parameters),
    async execute(
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      const runtimeOrganizationId = context?.organizationId || organizationId;
      if (runtimeOrganizationId !== organizationId) {
        return {
          status: "error",
          message: "Composio tool organization context mismatch",
        };
      }

      try {
        return await InternalApiService.executeComposioTool({
          organizationId,
          connectionId: discovered.connectionId,
          toolSlug: discovered.name,
          arguments: args,
        });
      } catch (error: any) {
        return {
          status: "error",
          message:
            error?.response?.data?.message ||
            error?.message ||
            "Composio tool execution failed",
        };
      }
    },
  };
}

export async function getComposioTools(
  organizationId?: string,
): Promise<Tool[]> {
  if (!organizationId) return [];

  const cached = cache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;

  try {
    const discovered = (await InternalApiService.getComposioTools(
      organizationId,
    )) as DiscoveredComposioTool[];
    const tools = discovered.map((tool) =>
      wrapComposioTool(tool, organizationId),
    );
    cache.set(organizationId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tools,
    });
    logger.info("Composio tools discovered for AI agent", {
      organizationId,
      toolCount: tools.length,
    });
    return tools;
  } catch (error: any) {
    logger.warn("Composio tool discovery failed; continuing without them", {
      organizationId,
      error: error?.response?.data?.message || error?.message || String(error),
    });
    return cached?.tools || [];
  }
}
