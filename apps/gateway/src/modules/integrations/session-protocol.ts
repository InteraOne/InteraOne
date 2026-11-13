import Ajv, { ErrorObject } from "ajv";
import type { IntegrationToolRisk } from "@shared/models";

export const COMPOSIO_SEARCH_TOOLS = "COMPOSIO_SEARCH_TOOLS";
export const COMPOSIO_GET_TOOL_SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS";
export const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";

export type SessionMetaPhase = "discovery" | "schema" | "execution";

export function sessionMetaPhase(metaToolSlug: string): SessionMetaPhase {
  if (metaToolSlug === COMPOSIO_SEARCH_TOOLS) return "discovery";
  if (metaToolSlug === COMPOSIO_GET_TOOL_SCHEMAS) return "schema";
  return "execution";
}

export interface SessionToolGrounding {
  discoveredToolSlugs: string[];
  toolSchemas: Record<string, Record<string, unknown>>;
}

export interface SessionSchemaGrounding {
  discoveredToolSlugs: string[];
  loadedSchemaSlugs: string[];
}

export function sessionSchemaGrounding(input: {
  discoveredToolSlugs: string[];
  toolSchemas: Record<string, Record<string, unknown>>;
}): SessionSchemaGrounding {
  return {
    discoveredToolSlugs: [...new Set(input.discoveredToolSlugs)].sort(),
    loadedSchemaSlugs: Object.keys(input.toolSchemas).sort(),
  };
}

export interface ProtocolValidationError {
  statusCode: 400 | 403;
  code: string;
  message: string;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

/** Extract only the documented tool identifiers and input schemas. */
export function extractSessionToolGrounding(
  data: unknown,
): SessionToolGrounding {
  const root = objectValue(data);
  const slugs = new Set<string>();
  const toolSchemas: Record<string, Record<string, unknown>> = {};
  if (!root) return { discoveredToolSlugs: [], toolSchemas };

  const results = Array.isArray(root.results) ? root.results : [];
  for (const result of results) {
    const record = objectValue(result);
    if (!record) continue;
    for (const slug of [
      ...stringArray(record.primary_tool_slugs),
      ...stringArray(record.related_tool_slugs),
    ]) {
      slugs.add(slug);
    }
  }

  const schemas = objectValue(root.tool_schemas);
  for (const [key, value] of Object.entries(schemas ?? {})) {
    const schemaRecord = objectValue(value);
    const slug =
      typeof schemaRecord?.tool_slug === "string"
        ? schemaRecord.tool_slug
        : key;
    if (!slug) continue;
    slugs.add(slug);
    const inputSchema = objectValue(schemaRecord?.input_schema);
    if (inputSchema && schemaRecord?.hasFullSchema !== false) {
      toolSchemas[slug] = inputSchema;
    }
  }

  return { discoveredToolSlugs: [...slugs].sort(), toolSchemas };
}

export function schemaRequestSlugs(args: Record<string, unknown>): string[] {
  return stringArray(args.tool_slugs);
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 5)
    .map((error) => {
      const path = error.instancePath || "arguments";
      const missing =
        typeof error.params.missingProperty === "string"
          ? ` ${error.params.missingProperty}`
          : "";
      return `${path}${missing} ${error.message ?? "is invalid"}`.trim();
    })
    .join("; ");
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
  allowUnionTypes: true,
});

export function validateSessionMetaCall(input: {
  metaToolSlug: string;
  args: Record<string, unknown>;
  allowedMetaTools: string[];
  discoveredToolSlugs: string[];
  toolSchemas: Record<string, Record<string, unknown>>;
  riskByTool: Map<string, IntegrationToolRisk>;
}): ProtocolValidationError | null {
  const discovered = new Set(input.discoveredToolSlugs);

  if (input.metaToolSlug === COMPOSIO_SEARCH_TOOLS) return null;

  if (input.metaToolSlug === COMPOSIO_GET_TOOL_SCHEMAS) {
    const requested = schemaRequestSlugs(input.args);
    if (requested.length === 0) {
      return {
        statusCode: 400,
        code: "INVALID_SCHEMA_REQUEST",
        message:
          "COMPOSIO_GET_TOOL_SCHEMAS must be called directly with a non-empty tool_slugs array copied exactly from COMPOSIO_SEARCH_TOOLS.",
      };
    }
    const unavailable = requested.find(
      (slug) => !discovered.has(slug) || !input.riskByTool.has(slug),
    );
    if (unavailable) {
      return {
        statusCode: input.riskByTool.has(unavailable) ? 400 : 403,
        code: "TOOL_NOT_DISCOVERED_OR_AUTHORIZED",
        message: `Tool slug "${unavailable}" is not available from this tenant-scoped discovery session. Call COMPOSIO_SEARCH_TOOLS directly, then copy an exact returned application tool slug into tool_slugs.`,
      };
    }
    return null;
  }

  if (input.metaToolSlug !== COMPOSIO_MULTI_EXECUTE_TOOL) return null;
  if (!Array.isArray(input.args.tools) || input.args.tools.length === 0) {
    return {
      statusCode: 400,
      code: "INVALID_MULTI_EXECUTE_TOOLS",
      message:
        "COMPOSIO_MULTI_EXECUTE_TOOL requires a non-empty tools array of discovered application tools.",
    };
  }

  for (const [index, value] of input.args.tools.entries()) {
    const tool = objectValue(value);
    if (!tool) {
      return {
        statusCode: 400,
        code: "INVALID_MULTI_EXECUTE_ENTRY",
        message: `tools[${index}] must be an object containing tool_slug and arguments.`,
      };
    }
    const slug = tool.tool_slug ?? tool.toolSlug ?? tool.slug;
    if (typeof slug !== "string" || slug.length === 0) {
      return {
        statusCode: 400,
        code: "MISSING_APPLICATION_TOOL_SLUG",
        message: `tools[${index}] must contain the exact tool_slug returned by COMPOSIO_SEARCH_TOOLS.`,
      };
    }
    if (input.allowedMetaTools.includes(slug) || slug.startsWith("COMPOSIO_")) {
      return {
        statusCode: 400,
        code: "NESTED_COMPOSIO_META_TOOL",
        message: `${slug} is a session meta-tool and cannot be nested inside COMPOSIO_MULTI_EXECUTE_TOOL. Invoke ${slug} directly as a native tool call. MULTI_EXECUTE_TOOL may contain only discovered application tool slugs.`,
      };
    }
    if (!input.riskByTool.has(slug)) {
      return {
        statusCode: 403,
        code: "INTEGRATION_TOOL_NOT_AUTHORIZED",
        message: `Application tool slug "${slug}" is not authorized for this tenant session. Call COMPOSIO_SEARCH_TOOLS directly and use only exact returned, organization-authorized slugs.`,
      };
    }
    if (!discovered.has(slug)) {
      return {
        statusCode: 400,
        code: "INTEGRATION_TOOL_NOT_DISCOVERED",
        message: `Application tool slug "${slug}" was not returned by COMPOSIO_SEARCH_TOOLS in this session. Discover it first and copy the returned slug exactly; do not abbreviate or invent tool names.`,
      };
    }
    const schema = input.toolSchemas[slug];
    if (!schema) {
      return {
        statusCode: 400,
        code: "INTEGRATION_TOOL_SCHEMA_REQUIRED",
        message: `The full input schema for "${slug}" is not loaded. Invoke COMPOSIO_GET_TOOL_SCHEMAS directly with {"tool_slugs":["${slug}"],"include":["input_schema"]}, then retry execution.`,
      };
    }
    const args = objectValue(tool.arguments);
    if (!args) {
      return {
        statusCode: 400,
        code: "INVALID_APPLICATION_TOOL_ARGUMENTS",
        message: `tools[${index}].arguments for "${slug}" must be an object matching its discovered input schema.`,
      };
    }
    try {
      const validate = ajv.compile(schema);
      if (!validate(args)) {
        return {
          statusCode: 400,
          code: "APPLICATION_TOOL_SCHEMA_VALIDATION_FAILED",
          message: `Arguments for "${slug}" do not match its Composio input schema: ${validationMessage(validate.errors)}. Correct the arguments using the schema result and retry.`,
        };
      }
    } catch {
      return {
        statusCode: 400,
        code: "INTEGRATION_TOOL_SCHEMA_INVALID",
        message: `The discovered schema for "${slug}" could not be validated locally. Retrieve the schema again before executing the tool.`,
      };
    }
  }
  return null;
}
