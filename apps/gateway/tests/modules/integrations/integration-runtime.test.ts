import { describe, expect, it } from "vitest";
import {
  capabilitySearchQuery,
  capabilitySearchQueries,
  candidatesMatchRequestedResources,
  crossToolkitCapabilitySearchQuery,
  compactConnectedToolQuery,
  isConnectedToolChannelAllowed,
  mergeCandidateGroupsRoundRobin,
  rankAuthorizedToolSlugs,
  requiredIdentifierQueries,
  mentionedToolkitSlugs,
  selectRelevantConnectedTools,
} from "@modules/integrations/integration-discovery";

describe("authorized tool fallback ranking", () => {
  it("finds a relevant schema without relying on Composio semantic search", () => {
    expect(
      rankAuthorizedToolSlugs(
        "List folders in Google Drive",
        [
          "GOOGLEDRIVE_CREATE_FILE",
          "GOOGLEDRIVE_LIST_FILES",
          "GOOGLEDRIVE_DELETE_FILE",
        ],
        2,
      ),
    ).toContain("GOOGLEDRIVE_LIST_FILES");
  });

  it("discovers prerequisites for required mutation identifiers", () => {
    expect(
      requiredIdentifierQueries([
        {
          slug: "GOOGLETASKS_CREATE_TASK",
          toolkitSlug: "googletasks",
          inputParameters: {
            type: "object",
            required: ["tasklist_id", "title"],
            properties: {
              tasklist_id: { type: "string" },
              title: { type: "string" },
            },
          },
        },
      ]),
    ).toEqual(["find tasklist"]);
  });

  it("works for non-Google integrations", () => {
    expect(
      rankAuthorizedToolSlugs(
        "send a message in Slack",
        ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE", "SLACK_ARCHIVE_CHANNEL"],
        1,
      ),
    ).toEqual(["SLACK_SEND_MESSAGE"]);
  });
});
import { validateToolArguments } from "@modules/integrations/integration-schema";
import { boundedResult } from "@modules/integrations/integrations.utils";
import { buildToolInputSchema } from "../../../../agent/src/infrastructure/providers/utils/tool-schema";
import {
  isDirectToolExecutionRequest,
  formatConnectedToolError,
  shouldRequireConnectedToolCall,
} from "../../../../agent/src/modules/agents/tools/connected-tool-routing";
import { sanitizeSchemaForModel } from "../../../../agent/src/modules/agents/tools/composio.tools";

describe("connected tool relevance discovery", () => {
  it("reduces concrete commands to a capability search phrase", () => {
    expect(
      compactConnectedToolQuery(
        "Create a new folder in Google Drive with name abhishek drive",
      ),
    ).toBe("create folder google drive");
  });

  it("normalizes read intents without naming any specific integration", () => {
    expect(capabilitySearchQuery("List folders in Google Drive")).toBe(
      "find folders google drive",
    );
    expect(capabilitySearchQuery("List channels in Slack")).toBe(
      "find channels slack",
    );
    expect(capabilitySearchQuery("Read messages in Teams")).toBe(
      "fetch messages teams",
    );
  });

  it("drops conversational filler from capability searches", () => {
    expect(capabilitySearchQuery("list out all google docs files")).toBe(
      "find google docs files",
    );
  });

  it("detects semantically wrong named-toolkit candidates", () => {
    expect(
      crossToolkitCapabilitySearchQuery("list out all google docs files", [
        "googledocs",
      ]),
    ).toBe("find file");
    expect(
      candidatesMatchRequestedResources(
        "list out all google docs files",
        [
          {
            slug: "GOOGLEDOCS_LIST_DRIVE_ITEM_PERMISSIONS",
            toolkitSlug: "googledocs",
          },
        ],
        ["googledocs"],
      ),
    ).toBe(false);
    expect(
      candidatesMatchRequestedResources(
        "list out all google docs files",
        [
          {
            slug: "GOOGLEDRIVE_FIND_FILE",
            toolkitSlug: "googledrive",
          },
        ],
        ["googledocs"],
      ),
    ).toBe(true);
  });

  it("separates compound actions from their concrete argument values", () => {
    expect(
      capabilitySearchQueries(
        "create a new folder with name abhishek gen ai and upload portfolio folder from my device",
      ),
    ).toEqual(["create folder", "upload portfolio folder", "upload folder"]);
  });

  it("normalizes a misspelled action and retains every compound capability", () => {
    expect(
      capabilitySearchQueries(
        "create a new doc file and wrire python calculator program",
      ),
    ).toEqual(["create doc file", "create file", "insert text"]);
  });

  it("round-robins compound candidates so later actions are not starved", () => {
    expect(
      mergeCandidateGroupsRoundRobin([
        [{ slug: "CREATE_1" }, { slug: "CREATE_2" }, { slug: "SHARED" }],
        [{ slug: "INSERT_1" }, { slug: "SHARED" }],
      ]).map((tool) => tool.slug),
    ).toEqual(["CREATE_1", "INSERT_1", "CREATE_2", "SHARED"]);
  });

  it("isolates toolkit mentions and configurable public channels", () => {
    expect(
      mentionedToolkitSlugs("List folders in Google Drive", [
        "googledrive",
        "notion",
      ]),
    ).toEqual(["googledrive"]);
    expect(isConnectedToolChannelAllowed("widget", "email,whatsapp")).toBe(
      false,
    );
    expect(isConnectedToolChannelAllowed("email", "email,whatsapp")).toBe(true);
  });

  it("preserves Composio relevance while enforcing connections and policy", () => {
    const tools = selectRelevantConnectedTools({
      candidates: [
        {
          slug: "GMAIL_FETCH_EMAILS",
          name: "Fetch emails",
          toolkitSlug: "gmail",
          inputParameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        },
        {
          slug: "NOTION_SEARCH",
          name: "Search Notion",
          toolkitSlug: "notion",
          inputParameters: { type: "object", properties: {} },
        },
        {
          slug: "SLACK_SEARCH_MESSAGES",
          name: "Search Slack",
          toolkitSlug: "slack",
          inputParameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
      connections: [
        { toolkitSlug: "gmail", connectionId: "gmail-connection" },
        { toolkitSlug: "slack", connectionId: "slack-connection" },
      ],
      policies: [
        {
          toolkitSlug: "gmail",
          allowedTools: [{ slug: "GMAIL_FETCH_EMAILS", risk: "read" }],
        },
        {
          toolkitSlug: "slack",
          allowedTools: [{ slug: "SLACK_SEARCH_MESSAGES", risk: "read" }],
        },
      ],
      limit: 12,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "GMAIL_FETCH_EMAILS",
      "SLACK_SEARCH_MESSAGES",
    ]);
    expect(tools[0].parameters).toMatchObject({
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("caps schemas before they enter LLM context", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      slug: `SLACK_TOOL_${index}`,
      toolkitSlug: "slack",
      inputParameters: { type: "object", properties: {} },
    }));
    const tools = selectRelevantConnectedTools({
      candidates,
      connections: [{ toolkitSlug: "slack", connectionId: "connection" }],
      policies: [
        {
          toolkitSlug: "slack",
          allowedTools: candidates.map((tool) => ({
            slug: tool.slug,
            risk: "read" as const,
          })),
        },
      ],
      limit: 4,
    });
    expect(tools).toHaveLength(4);
  });

  it("exposes nothing for disconnected accounts or denied tools", () => {
    const candidate = {
      slug: "GENERIC_LIST_RECORDS",
      toolkitSlug: "generic",
      inputParameters: { type: "object", properties: {} },
    };

    expect(
      selectRelevantConnectedTools({
        candidates: [candidate],
        connections: [], // disconnected accounts never enter this set
        policies: [
          {
            toolkitSlug: "generic",
            allowedTools: [{ slug: candidate.slug, risk: "read" }],
          },
        ],
        limit: 12,
      }),
    ).toEqual([]);

    expect(
      selectRelevantConnectedTools({
        candidates: [candidate],
        connections: [
          { toolkitSlug: "generic", connectionId: "other-tenant-connection" },
        ],
        policies: [
          {
            toolkitSlug: "generic",
            allowedTools: [],
          },
        ],
        limit: 12,
      }),
    ).toEqual([]);
  });
});

describe("connected-tool execution routing", () => {
  it("requires execution for a direct Drive command instead of allowing a guide", () => {
    const connectedTool = {
      name: "GOOGLEDRIVE_CREATE_FOLDER",
      description:
        "[Connected googledrive tool: GOOGLEDRIVE_CREATE_FOLDER] Creates a folder.",
      parameters: {},
      execute: async () => ({}),
    };

    expect(
      shouldRequireConnectedToolCall(
        "create a new folder in google drive named abhishek drive",
        [connectedTool],
      ),
    ).toBe(true);
    expect(
      shouldRequireConnectedToolCall(
        "how do I create a new folder in google drive?",
        [connectedTool],
      ),
    ).toBe(false);
  });

  it("requires read execution across integrations but not how-to guidance", () => {
    const tools = [
      {
        name: "GENERIC_FIND_RECORDS",
        description:
          "[Connected generic tool: GENERIC_FIND_RECORDS] Find records.",
        parameters: {},
        execute: async () => ({}),
      },
    ];

    for (const request of [
      "List folders in Google Drive",
      "find messages in Slack",
      "show pages in Notion",
      "fetch events from my calendar",
    ]) {
      expect(isDirectToolExecutionRequest(request)).toBe(true);
      expect(shouldRequireConnectedToolCall(request, tools)).toBe(true);
    }
    expect(isDirectToolExecutionRequest("How do I list folders?")).toBe(false);
    expect(isDirectToolExecutionRequest("hello")).toBe(false);
    expect(isDirectToolExecutionRequest("thanks")).toBe(false);
    expect(isDirectToolExecutionRequest("Can you approve this invoice?")).toBe(
      true,
    );
    expect(
      isDirectToolExecutionRequest("I need you to reconcile the transactions"),
    ).toBe(true);
    expect(isDirectToolExecutionRequest("Please deploy the application")).toBe(
      true,
    );
    expect(
      isDirectToolExecutionRequest("Can you explain invoice approval?"),
    ).toBe(false);
  });

  it("does not force a file upload before genuine file input exists", () => {
    const uploadTool = {
      name: "GENERIC_UPLOAD_FILE",
      description:
        "[Connected generic tool: GENERIC_UPLOAD_FILE] Upload a file.",
      parameters: {},
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "object", file_uploadable: true },
        },
      },
      execute: async () => ({}),
    };

    expect(
      shouldRequireConnectedToolCall("upload a file to this folder", [
        uploadTool,
      ]),
    ).toBe(false);
  });

  it("turns nested provider JSON into a concise real error", () => {
    expect(
      formatConnectedToolError(
        JSON.stringify({
          error: {
            code: 400,
            message: "Invalid field selection files",
          },
        }),
      ),
    ).toBe("Invalid field selection files");
  });

  it("removes executable examples and defaults from provider schemas", () => {
    expect(
      sanitizeSchemaForModel({
        type: "object",
        properties: {
          file: {
            type: "object",
            properties: {
              s3key: {
                type: "string",
                examples: ["47563/gmail/GET_ATTACHMENT/response/12345"],
                default: "foreign-key",
              },
            },
          },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        file: {
          type: "object",
          properties: { s3key: { type: "string" } },
        },
      },
    });
  });
});

describe("native schema argument validation", () => {
  const gmailSchema = {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      max_results: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["query"],
    additionalProperties: false,
  };

  const slackSchema = {
    type: "object",
    properties: {
      channel: { type: "string", pattern: "^[CGD]" },
      text: { type: "string", minLength: 1 },
    },
    required: ["channel", "text"],
    additionalProperties: false,
  };

  it("accepts valid arguments across different integrations", () => {
    expect(() =>
      validateToolArguments("GMAIL_FETCH_EMAILS", gmailSchema, {
        query: "is:unread",
        max_results: 20,
      }),
    ).not.toThrow();
    expect(() =>
      validateToolArguments("SLACK_SEND_MESSAGE", slackSchema, {
        channel: "C123",
        text: "Deployment complete",
      }),
    ).not.toThrow();
  });

  it("rejects missing, invalid, and invented parameters before execution", () => {
    expect(() =>
      validateToolArguments("GMAIL_FETCH_EMAILS", gmailSchema, {
        max_results: 500,
      }),
    ).toThrow(/Invalid arguments/);
    expect(() =>
      validateToolArguments("SLACK_SEND_MESSAGE", slackSchema, {
        channel: "invalid",
        text: "hello",
        fabricated_id: "fake",
      }),
    ).toThrow(/Invalid arguments/);
  });

  it("rejects provider example resource handles before SDK execution", () => {
    const uploadSchema = {
      type: "object",
      properties: {
        file_to_upload: {
          type: "object",
          file_uploadable: true,
          properties: {
            name: { type: "string", examples: ["document.pdf"] },
            mimetype: { type: "string", examples: ["application/pdf"] },
            s3key: {
              type: "string",
              description: "The S3 key of a staged file",
              examples: ["47563/gmail/GET_ATTACHMENT/response/12345"],
            },
          },
          required: ["name", "mimetype", "s3key"],
        },
      },
      required: ["file_to_upload"],
    };

    expect(() =>
      validateToolArguments("GENERIC_UPLOAD_FILE", uploadSchema, {
        file_to_upload: {
          name: "document.pdf",
          mimetype: "application/pdf",
          s3key: "47563/gmail/GET_ATTACHMENT/response/12345",
        },
      }),
    ).toThrow(/documentation example/);
  });
});

describe("LLM schema injection", () => {
  it("preserves Composio root constraints instead of flattening them", () => {
    const nativeSchema = {
      type: "object",
      properties: {
        payload: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          ],
        },
      },
      required: ["payload"],
      additionalProperties: false,
      $defs: { identifier: { type: "string", minLength: 1 } },
    };

    expect(
      buildToolInputSchema({
        name: "GENERIC_CONNECTED_TOOL",
        description: "A connected tool",
        parameters: {},
        inputSchema: nativeSchema,
        execute: async () => ({}),
      }),
    ).toEqual(nativeSchema);
  });
});

describe("structured result bounding", () => {
  it("retains real resource identifiers when a large result is compacted", () => {
    const result = boundedResult({
      records: Array.from({ length: 500 }, (_, index) => ({
        body: "x".repeat(500),
        message_id: `message-${index}`,
        url: `https://example.test/messages/${index}`,
      })),
      next_cursor: "cursor-2",
    }) as Record<string, unknown>;

    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).toContain("message-0");
    expect(JSON.stringify(result)).toContain("cursor-2");
    expect(
      Buffer.byteLength(JSON.stringify(result), "utf8"),
    ).toBeLessThanOrEqual(32_768);
  });

  it("retains human-readable names as well as IDs and URLs", () => {
    const result = boundedResult({
      records: Array.from({ length: 500 }, (_, index) => ({
        body: "x".repeat(500),
        id: `folder-${index}`,
        name: `Folder ${index}`,
        url: `https://example.test/folders/${index}`,
      })),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("Folder 0");
    expect(serialized).toContain("folder-0");
    expect(serialized).toContain("https://example.test/folders/0");
  });
});
