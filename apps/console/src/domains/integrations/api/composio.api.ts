import { apiClient } from "@/shared/lib/api-client";

export type ToolRisk = "read" | "write" | "sensitive";

export interface IntegrationToolkitSummary {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  category?: string;
  toolsCount: number;
  policy: {
    enabled: boolean;
    allowedTools: Array<{ slug: string; risk: ToolRisk }>;
  };
}

export interface IntegrationToolkit extends IntegrationToolkitSummary {
  tools: Array<{
    slug: string;
    name: string;
    description: string;
    risk: ToolRisk;
    defaultEnabled: boolean;
  }>;
}

export interface IntegrationCatalogResponse {
  success: boolean;
  data: {
    available: boolean;
    enabled: boolean;
    toolkits: IntegrationToolkitSummary[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface IntegrationToolkitResponse {
  success: boolean;
  data: {
    available: boolean;
    enabled: boolean;
    toolkit: IntegrationToolkit;
  };
}

export interface IntegrationConnection {
  _id: string;
  toolkitSlug: string;
  connectedAccountId: string;
  status: "pending" | "active" | "expired" | "disconnected" | "error";
  displayLabel?: string | null;
  lastError?: string | null;
  createdAt: string;
}

export interface IntegrationApproval {
  _id: string;
  toolkitSlug: string;
  toolSlug: string;
  risk: "write" | "sensitive";
  arguments: Record<string, unknown>;
  argumentHash: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "executing"
    | "executed"
    | "failed";
  expiresAt: string;
  requestedBy: { name?: string; email?: string } | string;
  error?: string | null;
  createdAt: string;
}

export const composioApi = {
  catalog: (input: { page: number; limit: number; search?: string }) => {
    const query = new URLSearchParams({
      page: String(input.page),
      limit: String(input.limit),
    });
    if (input.search?.trim()) query.set("search", input.search.trim());
    return apiClient.get<IntegrationCatalogResponse>(
      `/integrations/catalog?${query.toString()}`,
    );
  },
  toolkit: (slug: string) =>
    apiClient.get<IntegrationToolkitResponse>(`/integrations/catalog/${slug}`),
  connections: () =>
    apiClient.get<{ success: boolean; data: IntegrationConnection[] }>(
      "/integrations/connections",
    ),
  connect: (toolkit: string) =>
    apiClient.post<{
      success: boolean;
      data: { connectionId: string; authorizationUrl: string };
    }>(`/integrations/${toolkit}/connect`),
  status: (toolkit: string) =>
    apiClient.get<{ success: boolean; data: IntegrationConnection | null }>(
      `/integrations/${toolkit}/connection-status`,
    ),
  disconnect: (connectionId: string) =>
    apiClient.delete<{ success: boolean }>(
      `/integrations/connections/${connectionId}`,
    ),
  updatePolicy: (
    toolkit: string,
    input: {
      enabled: boolean;
      allowedTools: Array<{ slug: string; risk: ToolRisk }>;
    },
  ) => apiClient.put(`/integrations/${toolkit}/policy`, input),
  approvals: () =>
    apiClient.get<{ success: boolean; data: IntegrationApproval[] }>(
      "/integrations/approvals",
    ),
  approve: (id: string) =>
    apiClient.post(`/integrations/approvals/${id}/approve`),
  reject: (id: string) =>
    apiClient.post(`/integrations/approvals/${id}/reject`),
};
