import { Tool, ToolFilterOptions } from "../agent.types";
import { getComposioTools } from "./composio.tools";
import { isDirectToolExecutionRequest } from "./connected-tool-routing";

export interface ToolResolution {
  tools: Tool[];
  connectedIntent: boolean;
  connectedStatus: string;
  connectedMessage: string;
  relevantToolkits: string[];
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
  console.log(`[Tools] Registered tool: ${tool.name}`);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

/** Returns all registered tools as a list (used to build LLM function schemas) */
export function getAllTools(): Tool[] {
  return [...registry.values()];
}

/** Returns dynamically filtered tools based on conversation context/configuration */
export async function getToolsForContext(
  options: ToolFilterOptions,
): Promise<ToolResolution> {
  let tools = [...registry.values()];

  // If escalation is disabled, exclude escalate_to_human tool completely
  if (options.fallbackToAgent === false) {
    tools = tools.filter((tool) => tool.name !== "escalate_to_human");
  }

  // If the channel is email, exclude tools not applicable/required for email flow
  if (options.channel === "email") {
    tools = tools.filter(
      (tool) => tool.name !== "verify_email_otp" && tool.name !== "send_email",
    );
  }

  const directExecution = isDirectToolExecutionRequest(
    options.request || options.query || "",
  );
  // JIT discovery is for external execution intents, not greetings or ordinary
  // support questions. Keeping this boundary avoids adding Composio network
  // latency/failure modes to every chat turn.
  if (!directExecution) {
    return {
      tools,
      connectedIntent: false,
      connectedStatus: "not_requested",
      connectedMessage: "Connected-tool discovery was not required",
      relevantToolkits: [],
    };
  }

  const composioTools = await getComposioTools(
    options.organizationId,
    options.query,
    options.channel,
  );
  const connectedIntent =
    directExecution &&
    (composioTools.tools.length > 0 ||
      composioTools.relevantToolkits.length > 0);

  // Once a direct connected-app intent is resolved, irrelevant support tools
  // must not compete with it (web/FAQ/tickets/OTP were the observed failures).
  if (connectedIntent && composioTools.tools.length > 0) {
    return {
      tools: composioTools.tools,
      connectedIntent,
      connectedStatus: composioTools.status,
      connectedMessage: composioTools.message,
      relevantToolkits: composioTools.relevantToolkits,
    };
  }
  const names = new Set(tools.map((tool) => tool.name));
  for (const tool of composioTools.tools) {
    if (!names.has(tool.name)) {
      tools.push(tool);
      names.add(tool.name);
    }
  }

  return {
    tools,
    connectedIntent,
    connectedStatus: composioTools.status,
    connectedMessage: composioTools.message,
    relevantToolkits: composioTools.relevantToolkits,
  };
}

// ─── Register built-in tools ─────────────────────────────────────────────────
import { RewriteAndThinkTool } from "./rewrite-and-think.tool";
import { WebCrawlTool } from "./web-crawl.tool";
import { UpdateContactProfileTool } from "./update-contact-profile.tool";
import { MarkQueryResolvedTool } from "./mark-query-resolved.tool";

// New tools
import { FaqRetrievalTool } from "./faq-retrieval.tool";
import { KnowledgeRetrievalTool } from "./knowledge-retrieval.tool";
import { ConversationMemoryTool } from "./conversation-memory.tool";
import { SendEmailTool } from "./send-email.tool";
import { VerifyEmailOtpTool } from "./verify-email-otp.tool";
import { CreateTicketTool } from "./create-ticket.tool";
import { UpdateTicketTool } from "./update-ticket.tool";
import { GetTicketStatusTool } from "./get-ticket-status.tool";
import { CloseTicketTool } from "./close-ticket.tool";
import { EscalateToHumanTool } from "./escalate-to-human.tool";
import { SeekContactTool } from "./seek-contact.tool";
import { SaveUnansweredQuestionTool } from "./save-unanswered-question.tool";

// Built-in
registerTool(new RewriteAndThinkTool());
registerTool(new WebCrawlTool());
registerTool(new UpdateContactProfileTool());
registerTool(new MarkQueryResolvedTool());

// New AI tools
registerTool(new FaqRetrievalTool());
registerTool(new KnowledgeRetrievalTool());
registerTool(new ConversationMemoryTool());
registerTool(new SendEmailTool());
registerTool(new VerifyEmailOtpTool());
registerTool(new CreateTicketTool());
registerTool(new UpdateTicketTool());
registerTool(new GetTicketStatusTool());
registerTool(new CloseTicketTool());
registerTool(new EscalateToHumanTool());
registerTool(new SeekContactTool());
registerTool(new SaveUnansweredQuestionTool());

export type {
  Tool,
  ToolParameterSchema,
  ToolFilterOptions,
} from "../agent.types";
