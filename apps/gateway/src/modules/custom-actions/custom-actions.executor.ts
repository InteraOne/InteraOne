import { lookup } from "dns/promises";
import https from "https";
import { BlockList, isIP } from "net";
import { AppError } from "@shared/core/errors";
import { decryptCustomActionCredential } from "@shared/security/credential-cipher";
import { ICustomAction } from "@shared/models";
import { validateActionInput } from "./custom-actions.validation";

const BLOCKED_HEADERS = new Set(["authorization", "host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization"]);

function isPrivateIpv4(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, "");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet("::", 128, "ipv6");
blockedIpv6.addSubnet("::1", 128, "ipv6");
blockedIpv6.addSubnet("fc00::", 7, "ipv6");
blockedIpv6.addSubnet("fe80::", 10, "ipv6");
blockedIpv6.addSubnet("::ffff:0:0", 104, "ipv6");
blockedIpv6.addSubnet("::ffff:a00:0", 104, "ipv6");
blockedIpv6.addSubnet("::ffff:7f00:0", 104, "ipv6");
blockedIpv6.addSubnet("::ffff:a9fe:0", 112, "ipv6");
blockedIpv6.addSubnet("::ffff:ac10:0", 108, "ipv6");
blockedIpv6.addSubnet("::ffff:c0a8:0", 112, "ipv6");
blockedIpv6.addSubnet("::ffff:e000:0", 99, "ipv6");
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family !== 6) return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return mapped ? isPrivateIpv4(mapped) : blockedIpv6.check(ip, "ipv6");
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
  return JSON.parse(decryptCustomActionCredential(encrypted));
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

export async function executeCustomAction(action: ICustomAction, input: Record<string, unknown>, credentialOrigin?: string, requesterEmail?: string): Promise<CustomActionResult> {
  const startedAt = Date.now();
  validateActionInput(action.inputSchema, input);
  const authority = action.request.url.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || /[{}@\\]/.test(authority)) throw new AppError("Action URLs require a fixed HTTPS hostname", 400);
  const url = new URL(renderString(action.request.url, input, true));
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) throw new AppError("Custom actions must use HTTPS on port 443", 400);
  if (credentialOrigin && url.origin !== credentialOrigin) throw new AppError("Endpoint must match the integration origin", 400);
  const resolved = await resolvePublicAddress(url.hostname);
  const remainingMs = action.execution.timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new AppError("Custom action timed out", 502, "CUSTOM_ACTION_REQUEST_FAILED");
  const isOmitted = (template: string) => {
    const exact = template.match(/^\{\{([A-Za-z_]\w*)\}\}$/);
    return exact && !Object.hasOwn(input, exact[1]);
  };
  for (const [key, template] of Object.entries(action.request.query || {})) {
    if (!isOmitted(template)) url.searchParams.set(key, renderString(template, input, false));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  for (const [key, template] of Object.entries(action.request.headers || {})) {
    if (BLOCKED_HEADERS.has(key.toLowerCase())) throw new AppError(`Header ${key} is not allowed`, 400);
    if (!isOmitted(template)) headers[key] = renderString(template, input, false);
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
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "x-interaone-verified-email") delete headers[key];
  }
  url.searchParams.delete("X-InteraOne-Verified-Email");
  if (requesterEmail) headers["x-interaone-verified-email"] = requesterEmail;
  if (action.request.bodyTemplate !== undefined && !["GET", "DELETE"].includes(action.request.method)) {
    body = JSON.stringify(renderJson(action.request.bodyTemplate, input));
    headers["content-type"] = "application/json";
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    };
    const request = https.request(url, {
      method: action.request.method,
      headers,
      timeout: remainingMs,
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
        finish(resolve, { status: response.statusCode || 0, ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), durationMs: Date.now() - startedAt, headers: safeResponseHeaders(response.headers), body: parsed, truncated });
      });
      response.on("error", (error) => finish(reject, new AppError(error.message, 502, "CUSTOM_ACTION_REQUEST_FAILED")));
    });
    const deadline = setTimeout(() => request.destroy(new Error("Custom action timed out")), remainingMs);
    request.on("timeout", () => request.destroy(new Error("Custom action timed out")));
    request.on("error", (error) => finish(reject, new AppError(error.message, 502, "CUSTOM_ACTION_REQUEST_FAILED")));
    if (body) request.write(body);
    request.end();
  });
}
