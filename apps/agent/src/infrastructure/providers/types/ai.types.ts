import {
  Tool,
  ToolExecutionContext,
} from "../../../modules/agents/agent.types";

// ── Provider Identity ─────────────────────────────────────────────────────────
export type ProviderType = "bedrock" | "ollama" | "huggingface" | "openai";

// ── Model Capabilities ────────────────────────────────────────────────────────
export interface ModelCapabilities {
  modelId: string;
  provider: ProviderType;
  contextWindow: number;
  embeddingDimensions?: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsCustomDimensions?: boolean;
}

// ── LLM Types ─────────────────────────────────────────────────────────────────
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ToolEventData {
  type: "start" | "complete";
  toolName: string;
  label: string;
  detail?: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  /** Require at least one tool call on the first model turn. */
  requireToolCall?: boolean;
  toolContext?: ToolExecutionContext;
  onStream?: (chunk: string, isThought?: boolean) => void;
  onToolEvent?: (event: ToolEventData) => void;
}

export interface LLMTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LLMGenerateStep {
  toolName: string;
  args: unknown;
  result: unknown;
  error?: string;
  timestamp: Date;
}

export interface LLMGenerateResult {
  text: string;
  usage?: LLMTokenUsage;
  steps?: LLMGenerateStep[];
}

// ── Observability ─────────────────────────────────────────────────────────────
export interface AICallEvent {
  /** ISO timestamp */
  timestamp: string;
  provider: ProviderType;
  modelId: string;
  callType: "llm" | "embedding";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  success: boolean;
  error?: string;
  organizationId?: string;
  conversationId?: string;
}
