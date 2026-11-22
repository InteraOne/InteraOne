import { AppError } from "@shared/core/errors";

type JsonSchema = Record<string, any>;
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array"]);
const SCHEMA_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "default", "maxLength", "minimum", "maximum", "maxItems", "additionalProperties"]);

export function validateActionSchema(schema: unknown, depth = 0): asserts schema is JsonSchema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new AppError("inputSchema must be a JSON Schema object", 400);
  }
  const value = schema as JsonSchema;
  if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
    throw new AppError("Only additionalProperties: false is supported", 400);
  }
  for (const key of Object.keys(value)) {
    if (!SCHEMA_KEYS.has(key)) throw new AppError(`Unsupported inputSchema keyword: ${key}`, 400);
  }
  if (depth === 0 && value.type !== "object") {
    throw new AppError("inputSchema root type must be object", 400);
  }
  if (!TYPES.has(value.type)) throw new AppError(`Unsupported schema type: ${String(value.type)}`, 400);
  if (depth > 8) throw new AppError("inputSchema is too deeply nested", 400);
  if (value.properties !== undefined) {
    if (value.type !== "object" || !value.properties || typeof value.properties !== "object" || Array.isArray(value.properties)) {
      throw new AppError("properties is only valid for object schemas", 400);
    }
    if (Object.keys(value.properties).length > 100) throw new AppError("inputSchema has too many properties", 400);
    for (const [key, child] of Object.entries(value.properties)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new AppError(`Invalid input property name: ${key}`, 400);
      validateActionSchema(child, depth + 1);
    }
  }
  if (value.items !== undefined) {
    if (value.type !== "array") throw new AppError("items is only valid for array schemas", 400);
    validateActionSchema(value.items, depth + 1);
  }
  if (value.type === "array" && value.items === undefined) {
    throw new AppError("Array input schemas require items", 400);
  }
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some((item: unknown) => typeof item !== "string"))) {
    throw new AppError("inputSchema.required must be an array of property names", 400);
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length > 100)) {
    throw new AppError("inputSchema.enum must be an array with at most 100 values", 400);
  }
}

export function validateActionInput(schema: JsonSchema, input: unknown, path = "input"): void {
  const fail = (message: string): never => { throw new AppError(`${path} ${message}`, 400); };
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(input))) fail("is not an allowed value");
  switch (schema.type) {
    case "object": {
      if (!input || typeof input !== "object" || Array.isArray(input)) fail("must be an object");
      const record = input as Record<string, unknown>;
      const properties = schema.properties || {};
      for (const key of schema.required || []) if (!Object.hasOwn(record, key)) fail(`is missing required property ${key}`);
      for (const key of Object.keys(record)) if (!Object.hasOwn(properties, key)) fail(`contains unknown property ${key}`);
      for (const [key, value] of Object.entries(record)) validateActionInput(properties[key], value, `${path}.${key}`);
      return;
    }
    case "array": {
      if (!Array.isArray(input)) fail("must be an array");
      const values = input as unknown[];
      if (schema.maxItems !== undefined && values.length > schema.maxItems) fail(`must contain at most ${schema.maxItems} items`);
      values.forEach((item: unknown, index: number) => validateActionInput(schema.items, item, `${path}[${index}]`));
      return;
    }
    case "string": {
      if (typeof input !== "string") fail("must be a string");
      const value = input as string;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
      return;
    }
    case "number":
    case "integer": {
      if (typeof input !== "number" || !Number.isFinite(input) || (schema.type === "integer" && !Number.isInteger(input))) fail(`must be a valid ${schema.type}`);
      if (schema.minimum !== undefined && (input as number) < schema.minimum) fail(`must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && (input as number) > schema.maximum) fail(`must be at most ${schema.maximum}`);
      return;
    }
    case "boolean": if (typeof input !== "boolean") fail("must be a boolean"); return;
  }
}
