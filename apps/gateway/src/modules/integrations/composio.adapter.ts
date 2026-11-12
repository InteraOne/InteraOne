import { Composio, SessionPreset } from "@composio/core";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import { boundedResult, safeIntegrationError } from "./integrations.utils";

let client: Composio | undefined;
const SCOPED_SESSION_TTL_MS = 5 * 60 * 1000;
const scopedSessions = new Map<string, { session: any; expiresAt: number }>();

function assertConfigured(): void {
  if (!config.composio.enabled)
    throw new AppError(
      "Composio integrations are disabled",
      503,
      "COMPOSIO_DISABLED",
    );
  if (!config.composio.apiKey)
    throw new AppError(
      "Composio is not configured",
      503,
      "COMPOSIO_NOT_CONFIGURED",
    );
}

function getClient(): Composio {
  assertConfigured();
  if (!client) {
    client = new Composio({
      apiKey: config.composio.apiKey,
      allowTracking: false,
    });
  }
  return client;
}

function scopedSessionKey(params: {
  composioUserId: string;
  toolkitSlug: string;
  connectedAccountId: string;
  allowedToolSlugs: string[];
}): string {
  return [
    params.composioUserId,
    params.toolkitSlug,
    params.connectedAccountId,
    ...[...params.allowedToolSlugs].sort(),
  ].join(":");
}

async function getScopedSession(
  params: {
    composioUserId: string;
    toolkitSlug: string;
    connectedAccountId: string;
    allowedToolSlugs: string[];
  },
  signal: AbortSignal,
) {
  const key = scopedSessionKey(params);
  const cached = scopedSessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.session;
  if (cached) scopedSessions.delete(key);

  const session = await getClient().sessions.create(
    params.composioUserId,
    {
      sessionPreset: SessionPreset.DIRECT_TOOLS,
      toolkits: [params.toolkitSlug],
      tools: {
        [params.toolkitSlug]: { enable: params.allowedToolSlugs },
      },
      connectedAccounts: {
        [params.toolkitSlug]: [params.connectedAccountId],
      },
      manageConnections: false,
      sandbox: { enable: false },
    },
    { signal },
  );

  scopedSessions.set(key, {
    session,
    expiresAt: Date.now() + SCOPED_SESSION_TTL_MS,
  });
  if (scopedSessions.size > 500) {
    const oldestKey = scopedSessions.keys().next().value as string | undefined;
    if (oldestKey) scopedSessions.delete(oldestKey);
  }
  return session;
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.composio.timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    throw new AppError(
      safeIntegrationError(error),
      502,
      "COMPOSIO_REQUEST_FAILED",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function buildComposioUserId(
  organizationId: string,
  userId: string,
): string {
  const environment = config.composio.environment.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  return `interaone:${environment}:${organizationId}:${userId}`;
}

export const composioAdapter = {
  isAvailable(): boolean {
    return config.composio.enabled && Boolean(config.composio.apiKey);
  },

  async listToolkits() {
    return withTimeout(async (signal) => {
      const toolkits: Array<{
        slug: string;
        name: string;
        meta?: {
          description?: string;
          logo?: string;
          tools_count?: number;
          categories?: Array<{ name?: string }>;
        };
      }> = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({
          managed_by: "all",
          sort_by: "usage",
          limit: "1000",
        });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(
          `https://backend.composio.dev/api/v3.1/toolkits?${query.toString()}`,
          {
            headers: { "x-api-key": config.composio.apiKey! },
            signal,
          },
        );
        if (!response.ok) {
          throw new Error(
            `Composio toolkit catalog returned ${response.status}`,
          );
        }
        const page = (await response.json()) as {
          items?: typeof toolkits;
          next_cursor?: string | null;
        };
        toolkits.push(...(page.items ?? []));
        cursor = page.next_cursor || undefined;
      } while (cursor);

      return toolkits
        .filter((toolkit) => (toolkit.meta?.tools_count ?? 0) > 0)
        .map((toolkit) => ({
          slug: toolkit.slug.toLowerCase(),
          name: toolkit.name,
          description:
            toolkit.meta?.description ||
            `Connect ${toolkit.name} through Composio.`,
          logo: toolkit.meta?.logo,
          category: toolkit.meta?.categories?.[0]?.name || "Productivity",
          toolsCount: toolkit.meta?.tools_count ?? 0,
        }));
    });
  },

  async listCatalogTools(toolkitSlugs: string[]) {
    const composio = getClient();
    return withTimeout(async (signal) => {
      const tools = await composio.tools.getRawComposioTools(
        {
          toolkits: toolkitSlugs,
          important: false,
          limit: 1000,
        },
        undefined,
        { signal },
      );
      return tools
        .filter((tool) => !tool.isDeprecated && tool.toolkit?.slug)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
          toolkitSlug: tool.toolkit!.slug.toLowerCase(),
          inputParameters: tool.inputParameters,
          outputParameters: tool.outputParameters,
        }));
    });
  },

  /**
   * Use Composio's native catalog search to retrieve a small, relevant set of
   * tools with their complete schemas. The toolkit filter is derived only from
   * active, policy-enabled connections.
   */
  async searchCatalogTools(
    toolkitSlugs: string[],
    query: string,
    limit: number,
  ) {
    const composio = getClient();
    return withTimeout(async (signal) => {
      const tools = await composio.tools.getRawComposioTools(
        {
          toolkits: toolkitSlugs,
          search: query,
          important: false,
          limit,
        },
        undefined,
        { signal },
      );
      return tools
        .filter((tool) => !tool.isDeprecated && tool.toolkit?.slug)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
          toolkitSlug: tool.toolkit!.slug.toLowerCase(),
          inputParameters: tool.inputParameters,
          outputParameters: tool.outputParameters,
        }));
    });
  },

  async getCatalogTool(toolSlug: string) {
    const composio = getClient();
    return withTimeout(async (signal) => {
      const tools = await composio.tools.getRawComposioTools(
        { tools: [toolSlug] },
        undefined,
        { signal },
      );
      const tool = tools.find((candidate) => candidate.slug === toolSlug);
      if (!tool || !tool.toolkit?.slug) return null;
      return {
        slug: tool.slug,
        name: tool.name,
        description: tool.description,
        toolkitSlug: tool.toolkit.slug.toLowerCase(),
        inputParameters: tool.inputParameters,
        outputParameters: tool.outputParameters,
      };
    });
  },

  async getCatalogTools(toolSlugs: string[]) {
    if (toolSlugs.length === 0) return [];
    const composio = getClient();
    return withTimeout(async (signal) => {
      const tools = await composio.tools.getRawComposioTools(
        { tools: toolSlugs },
        undefined,
        { signal },
      );
      return tools
        .filter((tool) => !tool.isDeprecated && tool.toolkit?.slug)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
          toolkitSlug: tool.toolkit!.slug.toLowerCase(),
          inputParameters: tool.inputParameters,
          outputParameters: tool.outputParameters,
        }));
    });
  },

  async createConnectLink(params: {
    composioUserId: string;
    toolkitSlug: string;
    allowedToolSlugs: string[];
    callbackUrl?: string;
  }): Promise<{ connectedAccountId: string; redirectUrl: string }> {
    const composio = getClient();
    return withTimeout(async (signal) => {
      const session = await composio.sessions.create(
        params.composioUserId,
        {
          toolkits: [params.toolkitSlug],
          tools: { [params.toolkitSlug]: { enable: params.allowedToolSlugs } },
          manageConnections: false,
          sandbox: { enable: false },
        },
        { signal },
      );
      const request = await session.authorize(params.toolkitSlug, {
        callbackUrl: params.callbackUrl,
      });
      if (!request.redirectUrl)
        throw new Error("Composio did not return an authorization URL");
      return {
        connectedAccountId: request.id,
        redirectUrl: request.redirectUrl,
      };
    });
  },

  async getOwnedAccount(params: {
    composioUserId: string;
    toolkitSlug: string;
    connectedAccountId: string;
  }) {
    const composio = getClient();
    return withTimeout(async (signal) => {
      const response = await composio.connectedAccounts.list(
        {
          userIds: [params.composioUserId],
          toolkitSlugs: [params.toolkitSlug],
          limit: 100,
        },
        { signal },
      );
      return (
        response.items.find((item) => item.id === params.connectedAccountId) ??
        null
      );
    });
  },

  async disconnect(connectedAccountId: string): Promise<void> {
    await withTimeout((signal) =>
      getClient()
        .connectedAccounts.delete(connectedAccountId, { signal })
        .then(() => undefined),
    );
  },

  /**
   * Resolve the exact tools exposed by a tenant-scoped Composio session.
   * session.tools() is intentionally the source of truth so the AI receives
   * Composio's current names, descriptions, and JSON input schemas.
   */
  async sessionTools(params: {
    composioUserId: string;
    toolkitSlug: string;
    connectedAccountId: string;
    allowedToolSlugs: string[];
  }): Promise<
    Array<{
      slug: string;
      name?: string;
      description?: string;
      inputParameters?: Record<string, unknown>;
    }>
  > {
    return withTimeout(async (signal) => {
      const session = await getScopedSession(params, signal);
      const tools = (await session.tools(undefined, { signal })) as Array<any>;
      return tools
        .filter((tool) => typeof tool?.slug === "string")
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
          inputParameters: tool.inputParameters,
        }));
    });
  },

  async execute(params: {
    composioUserId: string;
    toolkitSlug: string;
    connectedAccountId: string;
    toolSlug: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown> {
    return withTimeout(async (signal) => {
      const session = await getScopedSession(
        {
          composioUserId: params.composioUserId,
          toolkitSlug: params.toolkitSlug,
          connectedAccountId: params.connectedAccountId,
          allowedToolSlugs: [params.toolSlug],
        },
        signal,
      );
      const result = await session.execute(
        params.toolSlug,
        params.arguments,
        undefined,
        { signal },
      );
      if (result.error) {
        throw new Error(result.error);
      }
      return boundedResult({
        status: "success",
        data: result.data,
        logId: result.logId,
      });
    });
  },
};
