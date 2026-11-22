import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customActionsApi } from "../api/custom-actions.api";
import type { CustomActionPayload } from "../types/types";

export const customActionKeys = {
  all: ["custom-actions"] as const,
  detail: (id: string) => ["custom-actions", id] as const,
};

export function useCustomActions() {
  return useQuery({ queryKey: customActionKeys.all, queryFn: customActionsApi.list });
}

export function useCustomAction(id?: string) {
  return useQuery({ queryKey: customActionKeys.detail(id || ""), queryFn: () => customActionsApi.get(id!), enabled: Boolean(id) });
}

export function useSaveCustomAction(id?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CustomActionPayload) => id ? customActionsApi.update(id, payload) : customActionsApi.create(payload),
    onSuccess: (action) => {
      client.invalidateQueries({ queryKey: customActionKeys.all });
      client.setQueryData(customActionKeys.detail(action._id), action);
    },
  });
}

export function useDeleteCustomAction() {
  const client = useQueryClient();
  return useMutation({ mutationFn: customActionsApi.remove, onSuccess: () => client.invalidateQueries({ queryKey: customActionKeys.all }) });
}

export function useTestCustomAction(id?: string) {
  return useMutation({ mutationFn: (input: Record<string, unknown>) => customActionsApi.test(id!, input) });
}
