import { Tool, ToolFilterOptions } from "../agent.types";
import { getComposioSessionTools } from "./composio-session.tools";

export interface ToolResolution {
  tools: Tool[];
  connectedIntent: boolean;
  connectedStatus: string;
  connectedMessage: string;
  composioSessionId?: string;
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

  const composioSession = await getComposioSessionTools({
    organizationId: options.organizationId,
    conversationId: options.conversationId,
    channel: options.channel || "widget",
  });
  const names = new Set(tools.map((tool) => tool.name));
  for (const tool of composioSession.tools) {
    if (!names.has(tool.name)) {
      tools.push(tool);
      names.add(tool.name);
    }
  }

  return {
    tools,
    connectedIntent: composioSession.tools.length > 0,
    connectedStatus: composioSession.status,
    connectedMessage: composioSession.message,
    composioSessionId: composioSession.sessionId,
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
