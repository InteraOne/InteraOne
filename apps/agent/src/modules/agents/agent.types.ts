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

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    readonly result: unknown,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export interface Tool {
  readonly name: string;

  readonly description: string;

  /** Origin used for orchestration and result verification. */
  readonly source?: "builtin" | "composio";

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
}
