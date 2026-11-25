export interface CollectUserInfo {
  name?: boolean;
  email?: boolean;
  phone?: boolean;
}

export interface KnownVisitorDetails {
  name?: string;
  email?: string;
}

export interface AIJobData {
  organizationId: string;
  conversationId: string;
  content: string;
  messageId: string;
  companyName?: string;
  fallbackToAgent?: boolean;
  collectUserInfo?: CollectUserInfo;
  channel?: "widget" | "email" | "whatsapp" | "telegram" | "threads";
  aiEnabled?: boolean;
  subscriptionExpired?: boolean;
}

export interface PipelineResult {
  conversationId: string;
  response: string;
}

export interface ContextMessage {
  messageId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ContextResult {
  systemPrompt: string;
  messages: ContextMessage[];
  turnCount: number;
}

export interface BuildSystemPromptOptions {
  companyName?: string;
  fallbackToAgent: boolean;
  collectUserInfo?: CollectUserInfo;
  knownVisitorDetails?: KnownVisitorDetails;
  channel?: "widget" | "email" | "whatsapp" | "telegram" | "threads";
}



export type Channel = "widget" | "email" | "whatsapp" | "telegram" | "threads";

export interface MiddlewareContext {
  job: AIJobData;
  conversationId: string;
  content: string;
  startTime: number;
  steps: any[];
  cid: string;
  t: (label: string) => string;
}

export interface MiddlewareResult {
  customActions?: Awaited<ReturnType<typeof import("../agents/tools/custom-action.tools").getCustomActionTools>>;
  shouldReturn: boolean;
  verifiedIdentityEmail?: string | null;
  otpCode?: string | null;
  channel?: Channel;
}
