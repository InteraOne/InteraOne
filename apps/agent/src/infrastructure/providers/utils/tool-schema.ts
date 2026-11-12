import { Tool } from "../../../modules/agents/agent.types";

/**
 * Return the complete provider-facing JSON Schema for a tool.
 *
 * Connected tools carry Composio's native root schema. Built-in tools still
 * use the legacy per-property representation and are converted here so every
 * provider receives schemas through one code path.
 */
export function buildToolInputSchema(tool: Tool): Record<string, unknown> {
  if (tool.inputSchema) {
    return tool.inputSchema;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, definition] of Object.entries(tool.parameters)) {
    if (name === "organizationId" || name === "conversationId") continue;
    const { required: isRequired, ...schema } = definition;
    properties[name] = schema;
    if (isRequired) required.push(name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
