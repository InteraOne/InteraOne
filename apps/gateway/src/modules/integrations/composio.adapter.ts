import {
  Composio,
  ComposioToolInputRequiredError,
  ToolRouterSessionMetaToolSlug,
} from "@composio/core";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import { safeIntegrationError } from "./integrations.utils";

export interface NativeSessionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SessionPolicyConfig {
  toolkitSlugs: string[];
  tools: Record<string, { enable: string[]; requireApproval?: string[] }>;
  connectedAccounts: Record<string, string[]>;
}

let client: Composio | undefined;

function assertConfigured(): void {
  if (!config.composio.enabled) {
    throw new AppError(
      "Composio integrations are disabled",
      503,
      "COMPOSIO_DISABLED",
    );
  }
  if (!config.composio.apiKey) {
    throw new AppError(
      "Composio is not configured",
      503,
      "COMPOSIO_NOT_CONFIGURED",
    );
  }
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

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.composio.timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof ComposioToolInputRequiredError) throw error;
    throw new AppError(
      safeIntegrationError(error),
      502,
      "COMPOSIO_REQUEST_FAILED",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function buildComposioUserId(organizationId: string): string {
  const environment = config.composio.environment.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  return `interaone:${environment}:organization:${organizationId}`;
}

function nativeTools(tools: unknown): NativeSessionTool[] {
  if (!Array.isArray(tools)) {
    throw new AppError("Composio returned an invalid session tool set", 502);
  }
  return tools.map((value) => {
    const tool = value as {
      type?: string;
      function?: {
        name?: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
    };
    if (
      tool.type !== "function" ||
      !tool.function?.name ||
      !tool.function.parameters
    ) {
      throw new AppError("Composio returned an invalid meta-tool schema", 502);
    }
    return {
      name: tool.function.name,
      description: tool.function.description || tool.function.name,
      inputSchema: tool.function.parameters,
    };
  });
}

export const composioAdapter = {
  isAvailable(): boolean {
    return config.composio.enabled && Boolean(config.composio.apiKey);
  },

  async listToolkits() {
    return withTimeout(async (signal) => {
      const toolkits = await getClient().toolkits.get(
        { managedBy: "all", sortBy: "usage", limit: 1000 },
        { signal },
      );
      return toolkits
        .filter((toolkit) => (toolkit.meta.toolsCount ?? 0) > 0)
        .map((toolkit) => ({
          slug: toolkit.slug.toLowerCase(),
          name: toolkit.name,
          description:
            toolkit.meta.description ||
            `Connect ${toolkit.name} through Composio.`,
          logo: toolkit.meta.logo,
          category: toolkit.meta.categories?.[0]?.name || "Productivity",
          toolsCount: toolkit.meta.toolsCount ?? 0,
        }));
    });
  },

  async getToolkit(toolkitSlug: string) {
    return withTimeout(async (signal) => {
      const toolkit = await getClient().toolkits.get(toolkitSlug, { signal });
      return {
        slug: toolkit.slug.toLowerCase(),
        name: toolkit.name,
        description:
          toolkit.meta.description ||
          `Connect ${toolkit.name} through Composio.`,
        logo: toolkit.meta.logo,
        category: toolkit.meta.categories?.[0]?.name || "Productivity",
        toolsCount: toolkit.meta.toolsCount ?? 0,
      };
    });
  },

  async listToolkitTools(toolkitSlug: string) {
    return withTimeout(async (signal) => {
      const tools = await getClient().tools.getRawComposioTools(
        { toolkits: [toolkitSlug], important: false, limit: 1000 },
        undefined,
        { signal },
      );
      return tools
        .filter((tool) => !tool.isDeprecated && tool.toolkit?.slug)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description || tool.name,
          toolkitSlug: tool.toolkit!.slug.toLowerCase(),
          tags: tool.tags ?? [],
        }));
    });
  },

  async createAuthorization(params: {
    composioUserId: string;
    toolkitSlug: string;
    allowedToolSlugs: string[];
    callbackUrl?: string;
  }): Promise<{
    connectedAccountId: string;
    redirectUrl: string;
    sessionId: string;
  }> {
    return withTimeout(async (signal) => {
      const session = await getClient().sessions.create(
        params.composioUserId,
        {
          toolkits: { enable: [params.toolkitSlug] },
          tools: {
            [params.toolkitSlug]: { enable: params.allowedToolSlugs },
          },
          manageConnections: false,
          sandbox: { enable: false },
        },
        { signal },
      );
      const request = await session.authorize(params.toolkitSlug, {
        callbackUrl: params.callbackUrl,
      });
      if (!request.redirectUrl) {
        throw new Error("Composio did not return an authorization URL");
      }
      return {
        connectedAccountId: request.id,
        redirectUrl: request.redirectUrl,
        sessionId: session.sessionId,
      };
    });
  },

  async getOwnedAccount(params: {
    composioUserId: string;
    toolkitSlug: string;
    connectedAccountId: string;
  }) {
    return withTimeout(async (signal) => {
      const response = await getClient().connectedAccounts.list(
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

  async createAgentSession(
    composioUserId: string,
    policy: SessionPolicyConfig,
  ): Promise<{ sessionId: string; tools: NativeSessionTool[] }> {
    return withTimeout(async (signal) => {
      const session = await getClient().sessions.create(
        composioUserId,
        {
          toolkits: { enable: policy.toolkitSlugs },
          tools: policy.tools,
          connectedAccounts: policy.connectedAccounts,
          manageConnections: false,
          sandbox: { enable: false },
        },
        { signal },
      );
      return {
        sessionId: session.sessionId,
        tools: nativeTools(await session.tools()),
      };
    });
  },

  async sessionTools(sessionId: string): Promise<NativeSessionTool[]> {
    return withTimeout(async (signal) => {
      const session = await getClient().sessions.use(sessionId, undefined, {
        signal,
      });
      return nativeTools(await session.tools());
    });
  },

  async executeMeta(
    sessionId: string,
    metaToolSlug: string,
    args: Record<string, unknown>,
    continuation?: {
      inputResponses: Record<string, unknown>;
      requestState?: string;
    },
  ) {
    return withTimeout(async (signal) => {
      const session = await getClient().sessions.use(sessionId, undefined, {
        signal,
      });
      return session.executeMeta(
        metaToolSlug as ToolRouterSessionMetaToolSlug,
        args,
        continuation,
        { signal },
      );
    });
  },

  async deleteSession(sessionId: string): Promise<void> {
    await withTimeout((signal) =>
      getClient()
        .sessions.delete(sessionId, { signal })
        .then(() => undefined),
    );
  },
};

export { ComposioToolInputRequiredError };
