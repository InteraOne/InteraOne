import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { composioApi } from "../api/composio.api";

const keys = {
  all: ["composio-integrations"] as const,
  catalog: ["composio-integrations", "catalog"] as const,
  connections: ["composio-integrations", "connections"] as const,
  approvals: ["composio-integrations", "approvals"] as const,
};

export function useComposioCatalog() {
  return useQuery({ queryKey: keys.catalog, queryFn: composioApi.catalog, select: (result) => result.data });
}

export function useComposioConnections() {
  return useQuery({
    queryKey: keys.connections,
    queryFn: composioApi.connections,
    select: (result) => result.data,
    refetchInterval: (query) => query.state.data?.data?.some((connection) => connection.status === "pending") ? 5000 : false,
  });
}

export function useComposioApprovals() {
  return useQuery({ queryKey: keys.approvals, queryFn: composioApi.approvals, select: (result) => result.data, refetchInterval: 15000 });
}

export function useConnectComposio() {
  return useMutation({ mutationFn: composioApi.connect, onSuccess: (result) => window.location.assign(result.data.authorizationUrl) });
}

export function useRefreshComposioStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: composioApi.status,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.connections }),
  });
}

export function useDisconnectComposio() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: composioApi.disconnect, onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.connections }) });
}

export function useUpdateComposioPolicy() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ toolkit, input }: { toolkit: string; input: Parameters<typeof composioApi.updatePolicy>[1] }) => composioApi.updatePolicy(toolkit, input), onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.catalog }) });
}

export function useDecideComposioApproval(action: "approve" | "reject") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => action === "approve" ? composioApi.approve(id) : composioApi.reject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.approvals }),
  });
}
