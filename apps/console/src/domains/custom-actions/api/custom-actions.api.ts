import { apiClient } from "@/shared/lib/api-client";
import type { CustomAction, CustomActionPayload, CustomActionTestResult } from "../types/types";

type Response<T> = { success: boolean; message: string; data: T };

export const customActionsApi = {
  list: async () => (await apiClient.get<Response<CustomAction[]>>("/actions")).data,
  get: async (actionId: string) => (await apiClient.get<Response<CustomAction>>(`/actions/${actionId}`)).data,
  create: async (payload: CustomActionPayload) => (await apiClient.post<Response<CustomAction>>("/actions", payload)).data,
  update: async (actionId: string, payload: CustomActionPayload) => (await apiClient.put<Response<CustomAction>>(`/actions/${actionId}`, payload)).data,
  remove: (actionId: string) => apiClient.delete(`/actions/${actionId}`),
  test: async (actionId: string, input: Record<string, unknown>) =>
    (await apiClient.post<Response<CustomActionTestResult>>(`/actions/${actionId}/test`, { input })).data,
};
