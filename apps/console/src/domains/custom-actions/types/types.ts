export type CustomActionMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type CustomActionAuthType = "none" | "bearer" | "basic" | "api_key";

export interface CustomAction {
  _id: string;
  name: string;
  category?: string;
  slug: string;
  description: string;
  enabled: boolean;
  audience?: "public" | "restricted" | "verified";
  integrationId?: string;
  request: {
    method: CustomActionMethod;
    url: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    bodyTemplate?: unknown;
  };
  authentication: {
    type: CustomActionAuthType;
    placement?: "header" | "query";
    keyName?: string;
    credentialHint?: string;
  };
  inputSchema: Record<string, unknown>;
  confirmation: { mode: "never" | "always" };
  execution: { timeoutMs: number; maxResponseBytes: number };
  createdAt: string;
  updatedAt: string;
}

export interface CustomActionPayload {
  name: string;
  category?: string;
  slug: string;
  description: string;
  enabled: boolean;
  audience?: CustomAction["audience"];
  request: CustomAction["request"];
  authentication: {
    type: CustomActionAuthType;
    placement?: "header" | "query";
    keyName?: string;
    credentials?: Record<string, string>;
  };
  inputSchema: Record<string, unknown>;
  confirmation: CustomAction["confirmation"];
  execution: CustomAction["execution"];
}

export interface CustomActionTestResult {
  status: number;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  truncated: boolean;
}
