export interface ToolParameterSchema {
  type?: string | string[];
  description?: string;
  required?: boolean;
  enum?: unknown[];
  items?: ToolParameterSchema | ToolParameterSchema[];
  properties?: Record<string, ToolParameterSchema>;
  [key: string]: unknown;
}

export interface ToolExecutionContext {
  organizationId?: string;
  conversationId?: string;
  messageId?: string;
}

export interface Tool {
  readonly name: string;

  readonly description: string;

  readonly parameters: Record<string, ToolParameterSchema>;
  /** Native JSON Schema. Prefer this over `parameters` when available. */
  readonly inputSchema?: Record<string, unknown>;
  /** Optional native result schema, retained for diagnostics and future routing. */
  readonly outputSchema?: Record<string, unknown>;
  /** Mutations run in model order; independent reads may run concurrently. */
  readonly executionMode?: "parallel" | "sequential";
  execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown>;
}

export interface ToolFilterOptions {
  fallbackToAgent?: boolean;
  channel?: "widget" | "email" | "whatsapp" | "telegram";
  organizationId?: string;
  conversationId?: string;
  /** Current conversational intent used to retrieve only relevant connected tools. */
  query?: string;
  /** Current user turn, used to distinguish commands from historical context. */
  request?: string;
}
