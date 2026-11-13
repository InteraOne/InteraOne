import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalApiService } from "../src/infrastructure/api/internal-api.service";
import {
  executeToolBatch,
  toolOutcomeContent,
} from "../src/modules/agents/tool-loop";
import { getComposioSessionTools } from "../src/modules/agents/tools/composio-session.tools";
import { Tool } from "../src/modules/agents/agent.types";

const context = {
  organizationId: "507f1f77bcf86cd799439011",
  conversationId: "507f191e810c19729de860ea",
  messageId: "message-1",
};

afterEach(() => vi.restoreAllMocks());

describe("native Composio session workflow", () => {
  it("automatically loads a partial discovery schema before execution", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      grounding: { discoveredToolSlugs: [], loadedSchemaSlugs: [] },
      tools: [
        {
          name: "COMPOSIO_SEARCH_TOOLS",
          description: "Discover tools",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "COMPOSIO_GET_TOOL_SCHEMAS",
          description: "Load schemas",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute tools",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    const execute = vi
      .spyOn(InternalApiService, "executeComposioSessionTool")
      .mockResolvedValueOnce({
        status: "completed",
        data: {
          results: [{ primary_tool_slugs: ["GENERIC_GET_RECORD"] }],
          tool_schemas: {
            GENERIC_GET_RECORD: {
              tool_slug: "GENERIC_GET_RECORD",
              hasFullSchema: false,
              schemaRef: { tool: "COMPOSIO_GET_TOOL_SCHEMAS" },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        data: {
          tool_schemas: {
            GENERIC_GET_RECORD: {
              tool_slug: "GENERIC_GET_RECORD",
              hasFullSchema: true,
              input_schema: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string" } },
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        data: { results: [{ tool_slug: "GENERIC_GET_RECORD", response: { successful: true } }] },
      });

    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });
    await executeToolBatch({
      calls: [{ id: "search", name: "COMPOSIO_SEARCH_TOOLS", input: {} }],
      tools: resolution.tools,
      context,
    });
    const [outcome] = await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              { tool_slug: "GENERIC_GET_RECORD", arguments: { id: "record-1" } },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });

    expect(outcome.step.error).toBeUndefined();
    expect(execute.mock.calls.map(([payload]) => payload.toolName)).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      "COMPOSIO_GET_TOOL_SCHEMAS",
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    ]);
    expect(execute.mock.calls[1][0].arguments).toEqual({
      tool_slugs: ["GENERIC_GET_RECORD"],
      include: ["input_schema"],
    });
  });

  it("reuses a full schema persisted in the tenant session", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      grounding: {
        discoveredToolSlugs: ["GENERIC_GET_RECORD"],
        loadedSchemaSlugs: ["GENERIC_GET_RECORD"],
      },
      tools: [
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute tools",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    const execute = vi
      .spyOn(InternalApiService, "executeComposioSessionTool")
      .mockResolvedValue({ status: "completed", data: { results: [] } });
    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });

    await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              { tool_slug: "GENERIC_GET_RECORD", arguments: { id: "record-1" } },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].toolName).toBe("COMPOSIO_MULTI_EXECUTE_TOOL");
  });

  it("recovers once when the gateway reports stale schema availability", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      tools: [
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute tools",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    const schemaRequired = {
      response: {
        status: 400,
        data: {
          code: "INTEGRATION_TOOL_SCHEMA_REQUIRED",
          message: "Load the full schema first",
        },
      },
    };
    const execute = vi
      .spyOn(InternalApiService, "executeComposioSessionTool")
      .mockRejectedValueOnce(schemaRequired)
      .mockResolvedValueOnce({
        status: "completed",
        data: {
          tool_schemas: {
            GENERIC_GET_RECORD: {
              tool_slug: "GENERIC_GET_RECORD",
              hasFullSchema: true,
              input_schema: { type: "object", properties: {} },
            },
          },
        },
      })
      .mockResolvedValueOnce({ status: "completed", data: { results: [] } });
    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });
    const [outcome] = await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              { tool_slug: "GENERIC_GET_RECORD", arguments: { id: "record-1" } },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });

    expect(outcome.step.error).toBeUndefined();
    expect(execute.mock.calls.map(([payload]) => payload.toolName)).toEqual([
      "COMPOSIO_MULTI_EXECUTE_TOOL",
      "COMPOSIO_GET_TOOL_SCHEMAS",
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    ]);
  });

  it("does not execute when schema retrieval is rejected by tenant policy", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      grounding: {
        discoveredToolSlugs: ["GENERIC_RESTRICTED_ACTION"],
        loadedSchemaSlugs: [],
      },
      tools: [
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute tools",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    const execute = vi
      .spyOn(InternalApiService, "executeComposioSessionTool")
      .mockRejectedValue({
        response: {
          status: 403,
          data: {
            code: "TOOL_NOT_DISCOVERED_OR_AUTHORIZED",
            message: "The application tool is not authorized",
          },
        },
      });
    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });
    const [outcome] = await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              { tool_slug: "GENERIC_RESTRICTED_ACTION", arguments: {} },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].toolName).toBe("COMPOSIO_GET_TOOL_SCHEMAS");
    expect(outcome.step.result).toMatchObject({
      status: "failed",
      phase: "schema",
      executed: false,
      retryable: false,
      code: "TOOL_NOT_DISCOVERED_OR_AUTHORIZED",
    });
  });

  it("discovers and executes a cross-application workflow through meta-tools", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      tools: [
        {
          name: "COMPOSIO_SEARCH_TOOLS",
          description: "Discover tools",
          inputSchema: {
            type: "object",
            properties: { queries: { type: "array" } },
            required: ["queries"],
          },
        },
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute discovered tools",
          inputSchema: {
            type: "object",
            properties: { tools: { type: "array" } },
            required: ["tools"],
          },
        },
      ],
    });
    const execute = vi
      .spyOn(InternalApiService, "executeComposioSessionTool")
      .mockResolvedValueOnce({
        status: "completed",
        data: {
          tools: ["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"],
          plan: ["fetch email", "send summary"],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        data: {
          results: [
            { tool: "GMAIL_FETCH_EMAILS", successful: true },
            { tool: "SLACK_SEND_MESSAGE", successful: true, ts: "123.456" },
          ],
        },
      });

    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });
    expect(resolution.tools.map((tool) => tool.name)).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    ]);
    expect(
      resolution.tools.every((tool) => tool.executionMode === "sequential"),
    ).toBe(true);

    const search = await executeToolBatch({
      calls: [
        {
          id: "search",
          name: "COMPOSIO_SEARCH_TOOLS",
          input: { queries: [{ use_case: "summarize email in Slack" }] },
        },
      ],
      tools: resolution.tools,
      context,
    });
    expect(search[0].step.error).toBeUndefined();

    const run = await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} },
              {
                tool_slug: "SLACK_SEND_MESSAGE",
                arguments: { channel: "C123", text: "Summary" },
              },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });
    expect(run[0].step.result).toMatchObject({ status: "completed" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns structured errors and continues later sequential calls", async () => {
    const order: string[] = [];
    const events: Array<{ type: string; status?: string }> = [];
    const tools: Tool[] = [
      {
        name: "first_write",
        description: "fails",
        parameters: {},
        executionMode: "sequential",
        async execute() {
          order.push("first");
          throw new Error("invalid destination");
        },
      },
      {
        name: "corrected_write",
        description: "succeeds",
        parameters: {},
        executionMode: "sequential",
        async execute() {
          order.push("second");
          return { status: "completed", id: "real-id" };
        },
      },
    ];
    const outcomes = await executeToolBatch({
      calls: [
        { id: "1", name: "first_write", input: {} },
        { id: "2", name: "corrected_write", input: {} },
      ],
      tools,
      context,
      onToolEvent: (event) => events.push(event),
    });
    expect(order).toEqual(["first", "second"]);
    expect(outcomes[0].step.error).toBe("invalid destination");
    expect(outcomes[1].step.result).toMatchObject({ id: "real-id" });
    expect(events.filter((event) => event.type === "complete")).toEqual([
      expect.objectContaining({ status: "failed" }),
      expect.objectContaining({ status: "succeeded" }),
    ]);
  });

  it("preserves a failed meta-tool response for the next LLM recovery turn", async () => {
    vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
      status: "ready",
      sessionId: "507f1f77bcf86cd799439012",
      tools: [
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "Execute discovered tools",
          inputSchema: {
            type: "object",
            properties: { tools: { type: "array" } },
            required: ["tools"],
          },
        },
      ],
    });
    vi.spyOn(
      InternalApiService,
      "executeComposioSessionTool",
    ).mockResolvedValue({
      status: "failed",
      error: "APP_CREATE_RECORD: Destination ID is not accessible",
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
    });

    const resolution = await getComposioSessionTools({
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      channel: "widget",
    });
    const [outcome] = await executeToolBatch({
      calls: [
        {
          id: "execute",
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          input: {
            tools: [
              {
                tool_slug: "APP_CREATE_RECORD",
                arguments: { destination_id: "bad-id" },
              },
            ],
          },
        },
      ],
      tools: resolution.tools,
      context,
    });

    expect(outcome.step.error).toBe(
      "APP_CREATE_RECORD: Destination ID is not accessible",
    );
    expect(outcome.step.result).toMatchObject({
      status: "failed",
      data: {
        results: [expect.objectContaining({ tool_slug: "APP_CREATE_RECORD" })],
      },
    });
  });

  it("waits for a mutation result before executing a dependent verification", async () => {
    let mutationCalls = 0;
    let verificationCalls = 0;
    const tool: Tool = {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      description: "Execute discovered application tools",
      parameters: {},
      source: "composio",
      executionMode: "sequential",
      async execute(args) {
        const entry = (args.tools as Array<Record<string, any>>)[0];
        if (entry.tool_slug === "APP_CREATE_RECORD") {
          mutationCalls += 1;
          return {
            status: "completed",
            phase: "execution",
            mutating: true,
            data: {
              results: [
                {
                  tool_slug: "APP_CREATE_RECORD",
                  response: {
                    successful: true,
                    data: { id: "real-record-id", url: "https://app/item/1" },
                  },
                },
              ],
            },
          };
        }
        verificationCalls += 1;
        expect(entry.arguments.id).toBe("real-record-id");
        return {
          status: "completed",
          phase: "execution",
          mutating: false,
          data: { id: "real-record-id", verified: true },
        };
      },
    };

    const firstRound = await executeToolBatch({
      calls: [
        {
          id: "create",
          name: tool.name,
          input: {
            tools: [{ tool_slug: "APP_CREATE_RECORD", arguments: {} }],
          },
        },
        {
          id: "premature-verify",
          name: tool.name,
          input: {
            tools: [
              {
                tool_slug: "APP_GET_RECORD",
                arguments: { id: "RECORD_ID_FROM_CREATION" },
              },
            ],
          },
        },
      ],
      tools: [tool],
      context,
    });

    expect(mutationCalls).toBe(1);
    expect(verificationCalls).toBe(0);
    expect(firstRound[1]).toMatchObject({
      deferred: true,
      step: {
        result: {
          status: "deferred",
          executed: false,
          code: "COMPOSIO_CALL_DEFERRED",
        },
      },
    });
    expect(toolOutcomeContent(firstRound[0])).toContain("real-record-id");

    const secondRound = await executeToolBatch({
      calls: [
        {
          id: "verify",
          name: tool.name,
          input: {
            tools: [
              {
                tool_slug: "APP_GET_RECORD",
                arguments: { id: "real-record-id" },
              },
            ],
          },
        },
      ],
      tools: [tool],
      context,
    });

    expect(secondRound[0].step.error).toBeUndefined();
    expect(mutationCalls).toBe(1);
    expect(verificationCalls).toBe(1);
  });

  it.each([
    ["COMPOSIO_SEARCH_TOOLS", "discovery"],
    ["COMPOSIO_GET_TOOL_SCHEMAS", "schema"],
  ])(
    "preserves actionable %s failures as structured results",
    async (name, phase) => {
      vi.spyOn(InternalApiService, "openComposioSession").mockResolvedValue({
        status: "ready",
        sessionId: "507f1f77bcf86cd799439012",
        tools: [
          {
            name,
            description: name,
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
      vi.spyOn(
        InternalApiService,
        "executeComposioSessionTool",
      ).mockRejectedValue({
        response: {
          status: 400,
          data: {
            code: "PROTOCOL_VALIDATION_FAILED",
            message: "Use an exact slug returned by discovery",
          },
        },
      });

      const resolution = await getComposioSessionTools({
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        channel: "widget",
      });
      const [outcome] = await executeToolBatch({
        calls: [{ id: "call", name, input: {} }],
        tools: resolution.tools,
        context,
      });

      expect(outcome.step.result).toMatchObject({
        status: "failed",
        phase,
        executed: false,
        retryable: true,
        code: "PROTOCOL_VALIDATION_FAILED",
        error: "Use an exact slug returned by discovery",
      });
    },
  );
});
