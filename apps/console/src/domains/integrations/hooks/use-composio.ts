import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { composioApi } from "../api/composio.api";

const keys = {
  all: ["composio-integrations"] as const,
  catalogRoot: ["composio-integrations", "catalog"] as const,
  catalog: (input: { page: number; limit: number; search?: string }) =>
    ["composio-integrations", "catalog", input] as const,
  toolkit: (slug: string) =>
    ["composio-integrations", "toolkit", slug] as const,
  connections: ["composio-integrations", "connections"] as const,
  approvals: ["composio-integrations", "approvals"] as const,
};

export function useComposioCatalog(input: {
  page: number;
  limit: number;
  search?: string;
}) {
  return useQuery({
    queryKey: keys.catalog(input),
    queryFn: () => composioApi.catalog(input),
    select: (result) => result.data,
    placeholderData: (previous) => previous,
  });
}

export function useComposioToolkit(slug: string) {
  return useQuery({
    queryKey: keys.toolkit(slug),
    queryFn: () => composioApi.toolkit(slug),
    select: (result) => result.data,
    enabled: Boolean(slug),
  });
}

export function useComposioConnections() {
  return useQuery({
    queryKey: keys.connections,
    queryFn: composioApi.connections,
    select: (result) => result.data,
    refetchInterval: (query) =>
      query.state.data?.data?.some(
        (connection) => connection.status === "pending",
      )
        ? 5000
        : false,
  });
}

export function useComposioApprovals() {
  return useQuery({
    queryKey: keys.approvals,
    queryFn: composioApi.approvals,
    select: (result) => result.data,
    refetchInterval: 15000,
  });
}

export function useConnectComposio() {
  return useMutation({
    mutationFn: composioApi.connect,
    onSuccess: (result) => window.location.assign(result.data.authorizationUrl),
  });
}

export function useRefreshComposioStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: composioApi.status,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.connections }),
  });
}

export function useDisconnectComposio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: composioApi.disconnect,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.connections }),
  });
}

export function useUpdateComposioPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      toolkit,
      input,
    }: {
      toolkit: string;
      input: Parameters<typeof composioApi.updatePolicy>[1];
    }) => composioApi.updatePolicy(toolkit, input),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: keys.catalogRoot });
      queryClient.invalidateQueries({
        queryKey: keys.toolkit(variables.toolkit),
      });
    },
  });
}

export function useDecideComposioApproval(action: "approve" | "reject") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      action === "approve" ? composioApi.approve(id) : composioApi.reject(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.approvals }),
  });
}
