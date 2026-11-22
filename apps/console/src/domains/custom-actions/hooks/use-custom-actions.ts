import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customActionsApi } from "../api/custom-actions.api";
import type { CustomActionPayload } from "../types/types";
import { toast } from "sonner";

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
  return useMutation({
    mutationFn: customActionsApi.remove,
    onSuccess: () => { toast.success("Action deleted"); void client.invalidateQueries({ queryKey: customActionKeys.all }); },
    onError: (error) => toast.error(error.message || "Could not delete action"),
  });
}

export function useDeleteCustomActions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: customActionsApi.bulkRemove,
    onSuccess: (result) => { toast.success(`${result.count} ${result.count === 1 ? "action" : "actions"} deleted`); void client.invalidateQueries({ queryKey: customActionKeys.all }); },
    onError: (error) => toast.error(error.message || "Could not delete actions"),
  });
}

export function useSetCustomActionsEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ actionIds, enabled }: { actionIds: string[]; enabled: boolean }) => customActionsApi.bulkStatus(actionIds, enabled),
    onSuccess: (result) => { toast.success(`${result.count} ${result.count === 1 ? "action" : "actions"} ${result.enabled ? "enabled" : "disabled"}`); void client.invalidateQueries({ queryKey: customActionKeys.all }); },
    onError: (error) => toast.error(error.message || "Could not update action status"),
  });
}

export function useTestCustomAction(id?: string) {
  return useMutation({ mutationFn: ({ input, requesterEmail }: { input: Record<string, unknown>; requesterEmail?: string }) => customActionsApi.test(id!, input, requesterEmail) });
}
