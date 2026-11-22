import { lookup } from "dns/promises";
import https from "https";
import { isIP } from "net";
import { AppError } from "@shared/core/errors";
import { decryptCredential } from "@shared/security/credential-cipher";
import { ICustomAction } from "@shared/models";
import { validateActionInput } from "./custom-actions.validation";

const BLOCKED_HEADERS = new Set(["authorization", "host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization"]);

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new AppError("Local network destinations are not allowed", 400);
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new AppError("Private or unresolved network destinations are not allowed", 400);
  }
  return records[0];
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, input);
}

function renderString(template: string, input: Record<string, unknown>, encode: boolean): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (_match, path) => {
    const value = readPath(input, path);
    if (value === undefined || value === null) throw new AppError(`Missing template input: ${path}`, 400);
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    return encode ? encodeURIComponent(rendered) : rendered;
  });
}

function renderJson(template: unknown, input: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    const exact = template.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}$/);
    return exact ? readPath(input, exact[1]) : renderString(template, input, false);
  }
  if (Array.isArray(template)) return template.map((item) => renderJson(item, input));
  if (template && typeof template === "object") return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderJson(value, input)]));
  return template;
}

function parseCredentials(action: ICustomAction): Record<string, string> {
  const encrypted = action.authentication.encryptedCredentials;
  if (!encrypted) return {};
  return JSON.parse(decryptCredential(encrypted));
}

export interface CustomActionResult {
  status: number;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  truncated: boolean;
}

function safeResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const allowed = new Set(["content-type", "content-length", "etag", "date", "x-request-id", "x-correlation-id"]);
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined)) as Record<string, string | string[]>;
}

export async function executeCustomAction(action: ICustomAction, input: Record<string, unknown>): Promise<CustomActionResult> {
  validateActionInput(action.inputSchema, input);
  const url = new URL(renderString(action.request.url, input, true));
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) throw new AppError("Custom actions must use HTTPS on port 443", 400);
  const resolved = await resolvePublicAddress(url.hostname);
  for (const [key, template] of Object.entries(action.request.query || {})) url.searchParams.set(key, renderString(template, input, false));

  const headers: Record<string, string> = { accept: "application/json" };
  for (const [key, template] of Object.entries(action.request.headers || {})) {
    if (BLOCKED_HEADERS.has(key.toLowerCase())) throw new AppError(`Header ${key} is not allowed`, 400);
    headers[key] = renderString(template, input, false);
  }
  const credentials = parseCredentials(action);
  if (action.authentication.type === "bearer") headers.authorization = `Bearer ${credentials.token || ""}`;
  if (action.authentication.type === "basic") headers.authorization = `Basic ${Buffer.from(`${credentials.username || ""}:${credentials.password || ""}`).toString("base64")}`;
  if (action.authentication.type === "api_key") {
    const keyName = action.authentication.keyName || "X-API-Key";
    if (action.authentication.placement === "query") url.searchParams.set(keyName, credentials.value || "");
    else headers[keyName] = credentials.value || "";
  }
  let body: string | undefined;
  if (action.request.bodyTemplate !== undefined && !["GET", "DELETE"].includes(action.request.method)) {
    body = JSON.stringify(renderJson(action.request.bodyTemplate, input));
    headers["content-type"] = "application/json";
  }

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: action.request.method,
      headers,
      timeout: action.execution.timeoutMs,
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      response.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const remaining = action.execution.maxResponseBytes - bytes;
        if (chunk.length > remaining) { chunks.push(chunk.subarray(0, Math.max(0, remaining))); truncated = true; }
        else { chunks.push(chunk); bytes += chunk.length; }
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: response.statusCode || 0, ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), durationMs: Date.now() - startedAt, headers: safeResponseHeaders(response.headers), body: parsed, truncated });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Custom action timed out")));
    request.on("error", (error) => reject(new AppError(error.message, 502, "CUSTOM_ACTION_REQUEST_FAILED")));
    if (body) request.write(body);
    request.end();
  });
}
