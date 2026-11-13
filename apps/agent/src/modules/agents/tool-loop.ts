import {
  LLMGenerateStep,
  ToolEventData,
} from "../../infrastructure/providers/types/ai.types";
import { Tool, ToolExecutionContext, ToolExecutionError } from "./agent.types";

export const MAX_TOOL_LOOPS = Math.max(
  1,
  Math.min(12, Number(process.env.AGENT_MAX_TOOL_LOOPS || 8)),
);
const MAX_CALLS_PER_TURN = Math.max(
  1,
  Math.min(50, Number(process.env.AGENT_MAX_TOOL_CALLS_PER_TURN || 20)),
);
const BUILTIN_SEQUENTIAL_TOOLS = new Set([
  "create_ticket",
  "update_ticket",
  "close_ticket",
  "send_email",
  "escalate_to_human",
]);

export interface NormalizedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolCallOutcome {
  call: NormalizedToolCall;
  step: LLMGenerateStep;
  /** Returned to the provider transcript but omitted from durable/UI steps. */
  deferred?: boolean;
}

function deferredComposioOutcome(call: NormalizedToolCall): ToolCallOutcome {
  const error =
    "This Composio call was not executed because an earlier Composio call from the same model turn must complete first. Inspect that call's structured result, copy its literal IDs or URLs, then issue only the next required meta-tool call. Do not repeat a completed mutation.";
  return {
    call,
    deferred: true,
    step: {
      toolName: call.name,
      args: call.input,
      result: {
        status: "deferred",
        phase: "orchestration",
        executed: false,
        retryable: true,
        code: "COMPOSIO_CALL_DEFERRED",
        error,
      },
      error,
      timestamp: new Date(),
    },
  };
}

function parseInput(input: unknown): Record<string, unknown> {
  const parsed = typeof input === "string" ? JSON.parse(input || "{}") : input;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function labelFor(toolName: string): string {
  const labels: Record<string, string> = {
    faq_retrieval: "Searching FAQs",
    knowledge_retrieval: "Searching uploaded knowledge",
    web_crawl: "Searching web",
    conversation_memory: "Checking conversation history",
    seek_contact: "Looking up contact",
    create_ticket: "Creating ticket",
    update_ticket: "Updating ticket",
    close_ticket: "Closing ticket",
    send_email: "Sending email",
    escalate_to_human: "Connecting to human agent",
    verify_email_otp: "Verifying code",
    update_contact_profile: "Saving contact details",
    mark_query_resolved: "Marking query resolved",
    COMPOSIO_SEARCH_TOOLS: "Discovering connected-app tools",
    COMPOSIO_GET_TOOL_SCHEMAS: "Loading connected-app schemas",
    COMPOSIO_MULTI_EXECUTE_TOOL: "Executing connected-app workflow",
    INTERAONE_RESOLVE_COMPOSIO_APPROVAL: "Resolving connected-app approval",
  };
  return labels[toolName] || "Working on it";
}

/**
 * Provider-neutral tool execution. Independent reads run concurrently while
 * mutations and approval continuations preserve model order. Every provider
 * feeds its native tool calls through this one bounded execution path.
 */
export async function executeToolBatch(input: {
  calls: NormalizedToolCall[];
  tools: Tool[];
  context?: ToolExecutionContext;
  onToolEvent?: (event: ToolEventData) => void;
}): Promise<ToolCallOutcome[]> {
  if (input.calls.length > MAX_CALLS_PER_TURN) {
    throw new Error(
      `Model requested ${input.calls.length} tools in one turn; limit is ${MAX_CALLS_PER_TURN}`,
    );
  }
  const outcomes = new Array<ToolCallOutcome>(input.calls.length);

  // A provider may emit Search, Schema, Execute, or dependent Execute calls in
  // one assistant turn. Their arguments are fixed before any result exists, so
  // running more than one can only use guesses/placeholders. Execute one
  // tenant-scoped Composio protocol call per LLM round and return every later
  // call as a structured, non-executed result. The next round then receives the
  // real SDK result and can form the next native call from literal values.
  let composioCallSeen = false;
  const deferredIndexes = new Set<number>();
  input.calls.forEach((call, index) => {
    const tool = input.tools.find((candidate) => candidate.name === call.name);
    if (tool?.source !== "composio") return;
    if (composioCallSeen) {
      outcomes[index] = deferredComposioOutcome(call);
      deferredIndexes.add(index);
      return;
    }
    composioCallSeen = true;
  });

  const execute = async (call: NormalizedToolCall, index: number) => {
    const tool = input.tools.find((candidate) => candidate.name === call.name);
    const timestamp = new Date();
    let args: Record<string, unknown> = {};
    let result: unknown;
    let error: string | undefined;
    input.onToolEvent?.({
      type: "start",
      toolName: call.name,
      label: labelFor(call.name),
    });
    try {
      if (!tool) throw new Error(`Unknown tool: ${call.name}`);
      args = parseInput(call.input);
      const runtimeArgs = {
        ...args,
        ...(input.context?.conversationId
          ? { conversationId: input.context.conversationId }
          : {}),
        ...(input.context?.organizationId
          ? { organizationId: input.context.organizationId }
          : {}),
      };
      result = await tool.execute(runtimeArgs, input.context);
      args = runtimeArgs;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      result = caught instanceof ToolExecutionError ? caught.result : { error };
    }
    input.onToolEvent?.({
      type: "complete",
      toolName: call.name,
      label: labelFor(call.name),
      detail: error ? "Failed" : undefined,
      status: error ? "failed" : "succeeded",
    });
    outcomes[index] = {
      call,
      step: { toolName: call.name, args, result, error, timestamp },
    };
  };

  const parallel: Array<Promise<void>> = [];
  const sequential: Array<{ call: NormalizedToolCall; index: number }> = [];
  input.calls.forEach((call, index) => {
    if (deferredIndexes.has(index)) return;
    const tool = input.tools.find((candidate) => candidate.name === call.name);
    if (
      tool?.executionMode === "sequential" ||
      BUILTIN_SEQUENTIAL_TOOLS.has(call.name)
    ) {
      sequential.push({ call, index });
    } else {
      parallel.push(execute(call, index));
    }
  });
  await Promise.all(parallel);
  for (const item of sequential) await execute(item.call, item.index);
  return outcomes;
}

export function toolOutcomeContent(outcome: ToolCallOutcome): string {
  return typeof outcome.step.result === "string"
    ? outcome.step.result
    : JSON.stringify(outcome.step.result);
}
