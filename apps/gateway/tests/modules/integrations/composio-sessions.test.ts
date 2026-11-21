import { describe, expect, it } from "vitest";
import {
  buildSessionPolicy,
  canReuseSession,
  classifyMetaExecution,
} from "@modules/integrations/integrations.policy";
import {
  failedMutationOutcome,
  mutationExecutionIdentity,
} from "@modules/integrations/integrations.service";
import {
  catalogToolFromComposio,
  riskFromComposioTags,
} from "@modules/integrations/integrations.policy";
import { buildComposioUserId } from "@modules/integrations/composio.adapter";
import {
  boundedResult,
  composioExecutionError,
} from "@modules/integrations/integrations.utils";

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
