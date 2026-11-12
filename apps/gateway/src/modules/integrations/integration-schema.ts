import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import { AppError } from "@shared/core/errors";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
  allowUnionTypes: true,
});

const validators = new Map<string, ValidateFunction>();

function validationMessage(errors?: ErrorObject[] | null): string {
  if (!errors?.length) return "Tool arguments do not match the required schema";
  return errors
    .slice(0, 5)
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message || "is invalid"}`;
    })
    .join("; ")
    .slice(0, 500);
}

function isReferenceField(name: string, schema: Record<string, unknown>): boolean {
  const description = typeof schema.description === "string" ? schema.description : "";
  return (
    /(?:s3key|filekey|storagekey|resourcekey|_id$|^id$|_url$|^url$|_uri$|^uri$|_token$|^token$|_cursor$|^cursor$)/i.test(
      name,
    ) || /\b(?:identifier|storage key|s3 key|resource id|folder id|file id)\b/i.test(description)
  );
}

function rejectSchemaExamples(
  schema: Record<string, unknown>,
  value: unknown,
  path = "",
  fieldName = "",
): void {
  if (
    typeof value === "string" &&
    isReferenceField(fieldName, schema) &&
    Array.isArray(schema.examples) &&
    schema.examples.some((example) => example === value)
  ) {
    throw new AppError(
      `Invalid arguments: ${path || "/"} matches a provider documentation example, not verified live data. Resolve it through an authorized connected tool or request genuine user input.`,
      400,
      "UNTRUSTED_EXAMPLE_ARGUMENT",
    );
  }

  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === "object" && !Array.isArray(itemSchema)) {
      value.forEach((item, index) =>
        rejectSchemaExamples(
          itemSchema as Record<string, unknown>,
          item,
          `${path}/${index}`,
          fieldName,
        ),
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childSchema = (properties as Record<string, unknown>)[key];
    if (!childSchema || typeof childSchema !== "object" || Array.isArray(childSchema)) continue;
    rejectSchemaExamples(
      childSchema as Record<string, unknown>,
      child,
      `${path}/${key}`,
      key,
    );
  }
}

/** Fail closed before a provider action receives malformed model arguments. */
export function validateToolArguments(
  toolSlug: string,
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  rejectSchemaExamples(schema, args);
  const cacheKey = `${toolSlug}:${JSON.stringify(schema)}`;
  let validate = validators.get(cacheKey);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
    } catch {
      throw new AppError(
        "The integration provider returned an invalid tool schema",
        502,
        "COMPOSIO_INVALID_SCHEMA",
      );
    }
    validators.set(cacheKey, validate);
    if (validators.size > 500) {
      const oldestKey = validators.keys().next().value as string | undefined;
      if (oldestKey) validators.delete(oldestKey);
    }
  }

  if (!validate(args)) {
    throw new AppError(
      `Invalid arguments for ${toolSlug}: ${validationMessage(validate.errors)}`,
      400,
      "INVALID_TOOL_ARGUMENTS",
    );
  }
}
