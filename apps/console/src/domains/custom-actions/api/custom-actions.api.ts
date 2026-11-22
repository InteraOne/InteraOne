import { apiClient } from "@/shared/lib/api-client";
import type { CustomAction, CustomActionPayload, CustomActionTestResult } from "../types/types";

type Response<T> = { success: boolean; message: string; data: T };

export const customActionsApi = {
  importSpec: async (specification: string, baseUrl: string, authentication: CustomActionPayload["authentication"]) =>
    (await apiClient.post<Response<{ count: number; skipped: string[] }>>("/actions/import", { specification, baseUrl, authentication })).data,
  list: async () => (await apiClient.get<Response<CustomAction[]>>("/actions")).data,
  get: async (actionId: string) => (await apiClient.get<Response<CustomAction>>(`/actions/${actionId}`)).data,
  create: async (payload: CustomActionPayload) => (await apiClient.post<Response<CustomAction>>("/actions", payload)).data,
  bulkStatus: async (actionIds: string[], enabled: boolean) =>
    (await apiClient.put<Response<{ count: number; enabled: boolean }>>("/actions/bulk/status", { actionIds, enabled })).data,
  bulkRemove: async (actionIds: string[]) =>
    (await apiClient.delete<Response<{ count: number }>>("/actions/bulk", { actionIds })).data,
  update: async (actionId: string, payload: CustomActionPayload) => (await apiClient.put<Response<CustomAction>>(`/actions/${actionId}`, payload)).data,
  remove: (actionId: string) => apiClient.delete(`/actions/${actionId}`),
  test: async (actionId: string, input: Record<string, unknown>, requesterEmail?: string) =>
    (await apiClient.post<Response<CustomActionTestResult>>(`/actions/${actionId}/test`, { input, requesterEmail })).data,
};
