import { load, JSON_SCHEMA } from "js-yaml";
import { AppError } from "@shared/core/errors";
import { validateActionSchema } from "./custom-actions.validation";

const methods = ["get", "post", "put", "patch", "delete"];
const MAX_OPERATIONS_PER_IMPORT = 1_000;

export function parseActionSpec(source: string, baseUrl?: string) {
  let spec: any;
  try {
    spec = load(source, { schema: JSON_SCHEMA });
  } catch {
    throw new AppError("Invalid OpenAPI JSON or YAML", 400);
  }
  if (!(String(spec?.openapi ?? "").startsWith("3.") || spec?.swagger === "2.0") || !spec.paths) {
    throw new AppError("Expected an OpenAPI 3.x or Swagger 2.0 specification", 400);
  }
  let base: URL;
  try {
    base = new URL(baseUrl || spec.servers?.[0]?.url ||
      (spec.host ? `https://${spec.host}${spec.basePath || ""}` : ""));
    if (base.protocol !== "https:" || base.port || base.username || base.password || base.search || base.hash) throw new Error();
  } catch {
    throw new AppError("Provide an absolute HTTPS base URL without credentials, query, or fragment", 400);
  }

  // Only resolve local JSON pointers. Import never fetches external references.
  function resolve(value: any, depth = 0): any {
    if (!value || depth > 12) throw new Error("Missing or recursive schema");
    if (!value.$ref) return value;
    if (typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) throw new Error("External references are unsupported");
    const target = value.$ref.slice(2).split("/").reduce((node: any, key: string) => {
      const property = key.replace(/~1/g, "/").replace(/~0/g, "~");
      return node && Object.hasOwn(node, property) ? node[property] : undefined;
    }, spec);
    return resolve(target, depth + 1);
  }

  let schemaNodes = 0;
  function inputSchema(raw: any, depth = 0, fallbackType = "string"): Record<string, any> {
    if (++schemaNodes > 4000) throw new Error("Specification exceeds the input schema size limit");
    if (depth > 7) throw new Error("Input schema is too deeply nested");
    const schema = resolve(raw);
    if (schema.oneOf || schema.anyOf || schema.allOf || schema.not || schema.format === "binary") {
      throw new Error("Composed or binary inputs are unsupported");
    }
    const inferredType = schema.properties ? "object"
      : schema.items ? "array"
        : schema.enum?.length ? typeof schema.enum[0]
          : schema.default !== undefined ? typeof schema.default
            : fallbackType;
    const result: Record<string, any> = { type: schema.type || inferredType };
    for (const key of ["description", "required", "enum", "minimum", "maximum", "maxLength", "maxItems"]) {
      if (schema[key] !== undefined) result[key] = schema[key];
    }
    if (schema.properties) result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, inputSchema(child, depth + 1)]),
    );
    if (schema.items) result.items = inputSchema(schema.items, depth + 1);
    if (result.type === "array" && !result.items) throw new Error("Array inputs require an item schema");
    return result;
  }

  const actions = [];
  const skipped: string[] = [];
  const slugs = new Set<string>();
  let count = 0;
  for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      if (++count > MAX_OPERATIONS_PER_IMPORT) {
        throw new AppError(`Import supports up to ${MAX_OPERATIONS_PER_IMPORT} operations per specification`, 400);
      }
      try {
        if (!path.startsWith("/") || /[?#\\]/.test(path)) throw new Error("Invalid operation path");
        if (!baseUrl && (operation.servers || pathItem.servers)) throw new Error("Set a base URL to override operation servers");
        const parameters = new Map<string, any>();
        for (const raw of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
          const p = resolve(raw);
          parameters.set(`${p.in}:${p.name}`, p);
        }
        const properties: Record<string, any> = Object.create(null);
        const required: string[] = [];
        const query: Record<string, string> = Object.create(null);
        const headers: Record<string, string> = Object.create(null);
        let urlPath = path;
        let bodyTemplate: string | undefined;
        function addInput(name: string, schema: any, mandatory: boolean) {
          const key = name.replace(/[^A-Za-z0-9_]/g, "_");
          const runtimeInput = ["orgId", "organizationId", "conversationId"].includes(key);
          if (!/^[A-Za-z_]/.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(properties, key)) {
            throw new Error(`Unsupported or duplicate input name: ${name}`);
          }
          properties[key] = runtimeInput
            ? { type: "string", description: "Automatically provided by InteraOne" }
            : inputSchema(schema, 0, name === "body" ? "object" : "string");
          if (mandatory && !runtimeInput) required.push(key);
          return `{{${key}}}`;
        }
        for (const p of parameters.values()) {
          if (p.in === "body") {
            bodyTemplate = addInput("body", p.schema, p.required);
            continue;
          }
          const schema = resolve(p.schema || p);
          if (["array", "object"].includes(schema.type)) throw new Error("Only scalar URL and header parameters are supported");
          const template = addInput(p.name, schema, p.in === "path" || p.required);
          if (p.in === "path") urlPath = urlPath.replaceAll(`{${p.name}}`, template);
          else if (p.in === "query") query[p.name] = template;
          else if (p.in === "header" && !/^(authorization|cookie|host|connection|content-length|transfer-encoding|upgrade|proxy-authorization)$/i.test(p.name)) headers[p.name] = template;
          else throw new Error(`Unsupported parameter: ${p.name}`);
        }
        if (operation.requestBody) {
          const body = resolve(operation.requestBody);
          const schema = body.content?.["application/json"]?.schema;
          if (!schema) throw new Error("Only JSON request bodies are supported");
          bodyTemplate = addInput("body", schema, body.required);
        }
        if (bodyTemplate && ["get", "delete"].includes(method)) throw new Error("Request body is unsupported for this method");
        if (/[{}]/.test(urlPath.replace(/\{\{\w+\}\}/g, ""))) throw new Error("Missing path parameter");
        const schema = { type: "object", properties, required };
        validateActionSchema(schema);
        const fallback = `${method} ${path}`;
        const prefix = (String(operation.operationId || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "") || method).slice(0, 42);
        let slug = prefix;
        for (let suffix = 2; slugs.has(slug); suffix++) slug = `${prefix}_${suffix}`;
        slugs.add(slug);
        actions.push({
          name: String(operation.summary || operation.operationId || fallback).slice(0, 100),
          description: String(operation.description || operation.summary || fallback).slice(0, 1000),
          slug,
          request: { method: method.toUpperCase(), url: base.href.replace(/\/$/, "") + urlPath, query, headers, bodyTemplate },
          inputSchema: schema,
          confirmation: { mode: method === "get" ? "never" : "always" },
        });
      } catch (error) {
        skipped.push(`${method.toUpperCase()} ${path}: ${(error as Error).message}`);
      }
    }
  }
  return { origin: base.origin, actions, skipped };
}
