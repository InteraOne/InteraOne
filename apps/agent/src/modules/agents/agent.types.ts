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
