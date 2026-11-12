import { createHash } from "crypto";
import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import logger from "../../../shared/logger";
import {
  Tool,
  ToolExecutionContext,
  ToolParameterSchema,
} from "../agent.types";
import { createMutationExecutionGuard } from "./mutation-execution-guard";
interface DiscoveredComposioTool {
  name: string;
  displayName?: string;
  description: string;
  parameters?: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  outputSchema?: Record<string, unknown>;
  connectionId: string;
  toolkitSlug: string;
  risk: "read" | "write" | "sensitive";
}

interface CacheEntry {
  expiresAt: number;
  resolution: ComposioToolResolution;
}

export type ComposioDiscoveryStatus =
  | "ready"
  | "disabled"
  | "not_configured"
  | "channel_restricted"
  | "no_active_connection"
  | "policy_denied"
  | "no_matching_tool"
  | "discovery_failed";

export interface ComposioToolResolution {
  tools: Tool[];
  status: ComposioDiscoveryStatus;
  message: string;
  relevantToolkits: string[];
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ComposioToolResolution>>();
const CACHE_TTL_MS = parseInt(
  process.env.COMPOSIO_TOOL_CACHE_TTL_MS || "30000",
  10,
);

/**
 * Provider schemas sometimes contain realistic-looking documentation values.
 * Those values are useful to a human, but an LLM can mistake them for live IDs
 * or file handles. Keep validation keywords while removing executable examples
 * and defaults before a schema reaches the model.
 */
export function sanitizeSchemaForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchemaForModel);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "example" || key === "examples" || key === "default") continue;
    sanitized[key] = sanitizeSchemaForModel(child);
  }
  return sanitized;
}

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
  const modelSchema = sanitizeSchemaForModel(
    discovered.parameters,
  ) as DiscoveredComposioTool["parameters"];
  const executeMutation =
    discovered.risk === "read" ? undefined : createMutationExecutionGuard();

  return {
    name: modelSafeName(discovered.name),
    description: `[Connected ${discovered.toolkitSlug} tool: ${discovered.name}] ${discovered.description}`,
    parameters: toParameters(modelSchema),
    inputSchema: modelSchema,
    outputSchema: discovered.outputSchema,
    executionMode: discovered.risk === "read" ? "parallel" : "sequential",
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

      const execute = async (): Promise<unknown> => {
        const toolArgs = { ...args };
        const declaredProperties = discovered.parameters?.properties || {};
        if (!("organizationId" in declaredProperties)) {
          delete toolArgs.organizationId;
        }
        if (!("conversationId" in declaredProperties)) {
          delete toolArgs.conversationId;
        }
        return InternalApiService.executeComposioTool({
          organizationId,
          connectionId: discovered.connectionId,
          toolSlug: discovered.name,
          arguments: toolArgs,
        });
      };

      try {
        return executeMutation
          ? await executeMutation(execute)
          : await execute();
      } catch (error: any) {
        throw new Error(
          error?.response?.data?.message ||
            error?.message ||
            "Composio tool execution failed",
        );
      }
    },
  };
}

export async function getComposioTools(
  organizationId?: string,
  query?: string,
  channel: "widget" | "email" | "whatsapp" | "telegram" = "widget",
): Promise<ComposioToolResolution> {
  const normalizedQuery = query?.trim().replace(/\s+/g, " ").slice(0, 2_000);
  if (!organizationId || !normalizedQuery) {
    return {
      tools: [],
      status: "no_matching_tool",
      message:
        "Organization and request context are required for connected-tool discovery",
      relevantToolkits: [],
    };
  }

  const queryHash = createHash("sha256")
    .update(normalizedQuery.toLowerCase())
    .digest("hex")
    .slice(0, 20);
  const cacheKey = `${organizationId}:${channel}:${queryHash}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.resolution;

  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;

  const request: Promise<ComposioToolResolution> = (async () => {
    try {
      const discovered = (await InternalApiService.getComposioTools(
        organizationId,
        normalizedQuery,
        channel,
      )) as {
        tools?: DiscoveredComposioTool[];
        status?: ComposioDiscoveryStatus;
        message?: string;
        relevantToolkits?: string[];
      };
      if (!discovered || !Array.isArray(discovered.tools)) {
        throw new Error(
          "Gateway returned an invalid connected-tool discovery response",
        );
      }
      const tools = discovered.tools.map((tool) =>
        wrapComposioTool(tool, organizationId),
      );
      const resolution: ComposioToolResolution = {
        tools,
        status:
          discovered.status ||
          (tools.length > 0 ? "ready" : "no_matching_tool"),
        message: discovered.message || "Connected-tool discovery completed",
        relevantToolkits: discovered.relevantToolkits || [],
      };
      // Cache only successful capability sets. Connection/policy/provider
      // failures must be visible immediately after an administrator fixes them.
      if (resolution.status === "ready") {
        cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          resolution,
        });
      }
      // Bound process-local cache growth across tenants and query variants.
      if (cache.size > 500) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (oldestKey) cache.delete(oldestKey);
      }
      logger.info("Relevant Composio tools discovered for AI agent", {
        organizationId,
        toolCount: tools.length,
      });
      return resolution;
    } catch (error: any) {
      const message =
        error?.response?.data?.message || error?.message || String(error);
      logger.error("Composio tool discovery failed", {
        organizationId,
        error: message,
      });
      return {
        tools: [],
        status: "discovery_failed",
        message,
        relevantToolkits: [],
      };
    } finally {
      pending.delete(cacheKey);
    }
  })();

  pending.set(cacheKey, request);
  return request;
}
