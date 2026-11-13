import { describe, expect, it } from "vitest";
import {
  buildSessionPolicy,
  canReuseSession,
  classifyMetaExecution,
  failedMutationOutcome,
  findDependencyPlaceholder,
  mutationExecutionIdentity,
} from "@modules/integrations/session-policy";
import {
  catalogToolFromComposio,
  riskFromComposioTags,
} from "@modules/integrations/integrations.policy";
import { buildComposioUserId } from "@modules/integrations/composio.adapter";
import {
  boundedResult,
  composioExecutionError,
} from "@modules/integrations/integrations.utils";
import {
  extractSessionToolGrounding,
  sessionSchemaGrounding,
  sessionMetaPhase,
  validateSessionMetaCall,
} from "@modules/integrations/session-protocol";

describe("Composio session policy", () => {
  it("builds a cross-integration session with pinned tenant accounts", () => {
    const userId = buildComposioUserId("org-a");
    const policy = buildSessionPolicy({
      composioUserId: userId,
      connections: [
        {
          toolkitSlug: "gmail",
          connectedAccountId: "ca_gmail",
          composioUserId: userId,
        },
        {
          toolkitSlug: "slack",
          connectedAccountId: "ca_slack",
          composioUserId: userId,
        },
      ],
      policies: [
        {
          toolkitSlug: "gmail",
          enabled: true,
          allowedTools: [{ slug: "GMAIL_FETCH_EMAILS", risk: "read" }],
        },
        {
          toolkitSlug: "slack",
          enabled: true,
          allowedTools: [
            { slug: "SLACK_SEND_MESSAGE", risk: "write" },
            { slug: "SLACK_DELETE_MESSAGE", risk: "sensitive" },
          ],
        },
      ],
    });

    expect(policy?.config.toolkitSlugs).toEqual(["gmail", "slack"]);
    expect(policy?.config.connectedAccounts).toEqual({
      gmail: ["ca_gmail"],
      slack: ["ca_slack"],
    });
    expect(policy?.config.tools.slack).toEqual({
      enable: ["SLACK_DELETE_MESSAGE", "SLACK_SEND_MESSAGE"],
      requireApproval: ["SLACK_DELETE_MESSAGE"],
    });
  });

  it("excludes a connected account owned by another tenant identity", () => {
    const policy = buildSessionPolicy({
      composioUserId: "tenant-a",
      connections: [
        {
          toolkitSlug: "github",
          connectedAccountId: "foreign-account",
          composioUserId: "tenant-b",
        },
      ],
      policies: [
        {
          toolkitSlug: "github",
          enabled: true,
          allowedTools: [{ slug: "GITHUB_GET_REPOS", risk: "read" }],
        },
      ],
    });
    expect(policy).toBeNull();
  });

  it("authorizes every tool in a native multi-execute batch", () => {
    const classification = classifyMetaExecution({
      metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
      args: {
        tools: [
          { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} },
          { tool_slug: "SLACK_SEND_MESSAGE", arguments: {} },
        ],
      },
      riskByTool: new Map([
        ["GMAIL_FETCH_EMAILS", "read"],
        ["SLACK_SEND_MESSAGE", "write"],
      ]),
    });
    expect(classification).toEqual({
      allowed: true,
      mutating: true,
      toolSlugs: ["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"],
    });

    expect(
      classifyMetaExecution({
        metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: { tools: [{ tool_slug: "DROP_DATABASE", arguments: {} }] },
        riskByTool: new Map(),
      }).allowed,
    ).toBe(false);
  });

  it("reuses only active, unexpired sessions with the same policy snapshot", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(
      canReuseSession({
        status: "active",
        policyHash: "same",
        expectedPolicyHash: "same",
        expiresAt: new Date("2026-11-12T10:01:00Z"),
        now,
      }),
    ).toBe(true);
    expect(
      canReuseSession({
        status: "active",
        policyHash: "old",
        expectedPolicyHash: "new",
        expiresAt: new Date("2026-11-12T10:01:00Z"),
        now,
      }),
    ).toBe(false);
  });

  it("deduplicates mutations independently of workflow bookkeeping", () => {
    const risks = new Map([
      ["NOTION_SEARCH", "read"],
      ["NOTION_CREATE_PAGE", "write"],
    ] as const);
    const first = mutationExecutionIdentity(
      {
        session_id: "first",
        current_step: "1",
        tools: [
          { tool_slug: "NOTION_SEARCH", arguments: { query: "parent" } },
          {
            tool_slug: "NOTION_CREATE_PAGE",
            arguments: { parent_id: "page-1", title: "Test" },
          },
        ],
      },
      risks,
    );
    const retry = mutationExecutionIdentity(
      {
        session_id: "second",
        current_step: "4",
        tools: [
          {
            tool_slug: "NOTION_CREATE_PAGE",
            arguments: { parent_id: "page-1", title: "Test" },
          },
        ],
      },
      risks,
    );
    expect(first).toEqual(retry);
  });

  it("rejects symbolic dependencies inside parallel multi-execute input", () => {
    expect(
      findDependencyPlaceholder({
        tools: [
          { tool_slug: "NOTION_SEARCH", arguments: { query: "" } },
          {
            tool_slug: "NOTION_CREATE_PAGE",
            arguments: { parent_id: "PARENT_ID_FROM_FETCH", title: "Test" },
          },
        ],
      }),
    ).toBe("PARENT_ID_FROM_FETCH");
    expect(
      findDependencyPlaceholder({
        tools: [
          {
            tool_slug: "NOTION_CREATE_PAGE",
            arguments: {
              parent_id: "41544a29-bca6-8157-983e-ea8c830ba5f2",
              title: "Test",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("marks partial or unknown mutation failures as non-replayable", () => {
    const risks = new Map([
      ["APP_CREATE_RECORD", "write"],
      ["APP_LOOKUP_RECORD", "read"],
    ] as const);
    expect(
      failedMutationOutcome({
        data: {
          results: [
            {
              tool_slug: "APP_CREATE_RECORD",
              response: { successful: false },
            },
          ],
        },
        toolSlugs: ["APP_CREATE_RECORD"],
        riskByTool: risks,
      }),
    ).toBe("failed");
    expect(
      failedMutationOutcome({
        data: {
          results: [
            {
              tool_slug: "APP_CREATE_RECORD",
              response: { successful: true },
            },
            {
              tool_slug: "APP_LOOKUP_RECORD",
              response: { successful: false },
            },
          ],
        },
        toolSlugs: ["APP_CREATE_RECORD", "APP_LOOKUP_RECORD"],
        riskByTool: risks,
      }),
    ).toBe("uncertain");
    expect(
      failedMutationOutcome({
        data: {},
        toolSlugs: ["APP_CREATE_RECORD"],
        riskByTool: risks,
      }),
    ).toBe("uncertain");
  });
});

describe("Composio execution errors", () => {
  it("surfaces the failed tool's provider error instead of a count summary", () => {
    expect(
      composioExecutionError({
        resultType: "failed",
        error: "1 out of 1 tools failed",
        data: {
          results: [
            {
              tool_slug: "APP_CREATE_RECORD",
              response: {
                successful: false,
                error: "Destination ID is not accessible",
              },
            },
          ],
        },
      }),
    ).toBe("APP_CREATE_RECORD: Destination ID is not accessible");
  });
});

describe("native Composio meta-tool protocol", () => {
  const risks = new Map([
    ["GOOGLEDRIVE_CREATE_FOLDER", "write"],
    ["SLACK_SEND_MESSAGE", "write"],
    ["NOTION_SEARCH_NOTION_PAGE", "read"],
  ] as const);
  const allowedMetaTools = [
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
  ];

  it("classifies discovery, schema, and execution failures separately", () => {
    expect(sessionMetaPhase("COMPOSIO_SEARCH_TOOLS")).toBe("discovery");
    expect(sessionMetaPhase("COMPOSIO_GET_TOOL_SCHEMAS")).toBe("schema");
    expect(sessionMetaPhase("COMPOSIO_MULTI_EXECUTE_TOOL")).toBe("execution");
  });

  it("rejects nested meta-tools and invented application slugs actionably", () => {
    expect(
      validateSessionMetaCall({
        metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: {
          tools: [
            {
              tool_slug: "COMPOSIO_GET_TOOL_SCHEMAS",
              arguments: { tool_slugs: ["DRIVE_CREATE_FOLDER"] },
            },
          ],
        },
        allowedMetaTools,
        discoveredToolSlugs: ["GOOGLEDRIVE_CREATE_FOLDER"],
        toolSchemas: {},
        riskByTool: risks,
      }),
    ).toMatchObject({ code: "NESTED_COMPOSIO_META_TOOL", statusCode: 400 });
    expect(
      validateSessionMetaCall({
        metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: {
          tools: [{ tool_slug: "DRIVE_CREATE_FOLDER", arguments: {} }],
        },
        allowedMetaTools,
        discoveredToolSlugs: ["GOOGLEDRIVE_CREATE_FOLDER"],
        toolSchemas: {},
        riskByTool: risks,
      }),
    ).toMatchObject({
      code: "INTEGRATION_TOOL_NOT_AUTHORIZED",
      statusCode: 403,
    });
  });

  it("grounds discovery, direct schema retrieval, and execution across apps", () => {
    const discovery = extractSessionToolGrounding({
      results: [
        {
          primary_tool_slugs: ["GOOGLEDRIVE_CREATE_FOLDER"],
          related_tool_slugs: ["SLACK_SEND_MESSAGE"],
        },
      ],
      tool_schemas: {
        GOOGLEDRIVE_CREATE_FOLDER: {
          tool_slug: "GOOGLEDRIVE_CREATE_FOLDER",
          hasFullSchema: false,
          schemaRef: { tool: "COMPOSIO_GET_TOOL_SCHEMAS" },
        },
        SLACK_SEND_MESSAGE: {
          tool_slug: "SLACK_SEND_MESSAGE",
          hasFullSchema: true,
          input_schema: {
            type: "object",
            required: ["channel", "text"],
            properties: {
              channel: { type: "string" },
              text: { type: "string" },
            },
          },
        },
      },
    });
    expect(discovery.discoveredToolSlugs).toEqual([
      "GOOGLEDRIVE_CREATE_FOLDER",
      "SLACK_SEND_MESSAGE",
    ]);
    expect(discovery.toolSchemas).toHaveProperty("SLACK_SEND_MESSAGE");
    expect(discovery.toolSchemas).not.toHaveProperty(
      "GOOGLEDRIVE_CREATE_FOLDER",
    );
    expect(
      validateSessionMetaCall({
        metaToolSlug: "COMPOSIO_GET_TOOL_SCHEMAS",
        args: { tool_slugs: ["GOOGLEDRIVE_CREATE_FOLDER"] },
        allowedMetaTools,
        discoveredToolSlugs: discovery.discoveredToolSlugs,
        toolSchemas: discovery.toolSchemas,
        riskByTool: risks,
      }),
    ).toBeNull();

    const schemaResult = extractSessionToolGrounding({
      tool_schemas: {
        GOOGLEDRIVE_CREATE_FOLDER: {
          tool_slug: "GOOGLEDRIVE_CREATE_FOLDER",
          hasFullSchema: true,
          input_schema: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: { name: { type: "string" } },
          },
        },
      },
    });
    const schemas = {
      ...discovery.toolSchemas,
      ...schemaResult.toolSchemas,
    };
    expect(
      validateSessionMetaCall({
        metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: {
          tools: [
            {
              tool_slug: "GOOGLEDRIVE_CREATE_FOLDER",
              arguments: { name: "Project" },
            },
            {
              tool_slug: "SLACK_SEND_MESSAGE",
              arguments: { channel: "C123", text: "Created" },
            },
          ],
        },
        allowedMetaTools,
        discoveredToolSlugs: discovery.discoveredToolSlugs,
        toolSchemas: schemas,
        riskByTool: risks,
      }),
    ).toBeNull();
  });

  it("reports only actually persisted full schemas as reusable", () => {
    expect(
      sessionSchemaGrounding({
        discoveredToolSlugs: ["APP_PARTIAL", "APP_READY", "APP_READY"],
        toolSchemas: {
          APP_READY: { type: "object", properties: {} },
        },
      }),
    ).toEqual({
      discoveredToolSlugs: ["APP_PARTIAL", "APP_READY"],
      loadedSchemaSlugs: ["APP_READY"],
    });
  });

  it("rejects arguments outside the discovered Composio schema", () => {
    expect(
      validateSessionMetaCall({
        metaToolSlug: "COMPOSIO_MULTI_EXECUTE_TOOL",
        args: {
          tools: [
            {
              tool_slug: "SLACK_SEND_MESSAGE",
              arguments: { channel: "C123" },
            },
          ],
        },
        allowedMetaTools,
        discoveredToolSlugs: ["SLACK_SEND_MESSAGE"],
        toolSchemas: {
          SLACK_SEND_MESSAGE: {
            type: "object",
            required: ["channel", "text"],
            properties: {
              channel: { type: "string" },
              text: { type: "string" },
            },
          },
        },
        riskByTool: risks,
      }),
    ).toMatchObject({ code: "APPLICATION_TOOL_SCHEMA_VALIDATION_FAILED" });
  });
});

describe("official Composio risk hints", () => {
  it("uses behavioral hints without action-name regexes", () => {
    expect(riskFromComposioTags(["readOnlyHint"])).toBe("read");
    expect(riskFromComposioTags(["createHint"])).toBe("write");
    expect(riskFromComposioTags(["destructiveHint"])).toBe("sensitive");
    expect(riskFromComposioTags([])).toBe("write");
  });

  it("requires native approval for sensitive catalog tools", () => {
    expect(
      catalogToolFromComposio({
        slug: "GENERIC_REMOVE_RECORD",
        name: "Remove record",
        description: "Removes a record.",
        tags: ["destructiveHint"],
      }),
    ).toMatchObject({
      risk: "sensitive",
      defaultEnabled: false,
      requiresApproval: true,
    });
  });
});

describe("Composio result compaction", () => {
  it("preserves deeply nested actionable IDs and URLs", () => {
    const pageId = "41544a29-bca6-8157-983e-ea8c830ba5f2";
    const result = boundedResult({
      data: {
        results: Array.from({ length: 40 }, (_, index) => ({
          response: {
            data: {
              results: [
                {
                  wrapper: {
                    record: {
                      id: index === 0 ? pageId : `page-${index}`,
                      title: `Page ${index}`,
                      url: `https://example.test/page/${index}`,
                      content: "x".repeat(2_000),
                    },
                  },
                },
              ],
            },
          },
        })),
      },
    });

    expect(JSON.stringify(result)).toContain(pageId);
  });
});
