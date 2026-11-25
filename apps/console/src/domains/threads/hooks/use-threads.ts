import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "@/domains/auth/api/auth.api";
import { portalErrorStatus, threadsApi } from "../api/threads.api";
import type {
  ManageThreadsFilters,
  PortalView,
  ThreadsHttpMethod,
} from "../types/types";

const PORTAL_REFRESH_INTERVAL_MS = 30_000;
const THREAD_REFRESH_INTERVAL_MS = 8_000;

export const threadKeys = {
  portal: (slug: string) => ["threads", slug] as const,
  management: (organizationScope: string) =>
    ["manage-threads", organizationScope] as const,
};

const shouldRetry = (tries: number, error: Error) =>
  tries < 2 && (portalErrorStatus(error) ?? 500) >= 500;

export function useCustomDomainBrand() {
  return useQuery({
    queryKey: ["custom-domain-portal", window.location.hostname],
    queryFn: threadsApi.getHostBrand,
    retry: shouldRetry,
  });
}

type PortalQueriesInput = {
  slug: string;
  base: string;
  token: string;
  threadId?: string;
  before?: string;
  view: PortalView;
  query: string;
  page: number;
  sort: string;
  category: string;
};

export function usePortalQueries({
  slug,
  base,
  token,
  threadId,
  before,
  view,
  query,
  page,
  sort,
  category,
}: PortalQueriesInput) {
  const prefix = threadKeys.portal(slug);
  const brand = useQuery({
    queryKey: ["portal-brand", slug],
    queryFn: () => threadsApi.getPortalBrand(base),
    retry: shouldRetry,
    refetchInterval: PORTAL_REFRESH_INTERVAL_MS,
  });

  const list = useQuery({
    queryKey: [...prefix, "list", base, token, view, query, page, sort, category],
    enabled: Boolean(brand.data) && !threadId,
    refetchInterval: PORTAL_REFRESH_INTERVAL_MS,
    retry: shouldRetry,
    queryFn: () => {
      if (view === "updates") return threadsApi.getUpdates(base, token);

      const params = new URLSearchParams({
        q: query,
        sort,
        ...(view === "feature"
          ? { category: "feature" }
          : category
            ? { category }
            : {}),
        page: String(page),
        ...(view === "mine" ? { mine: "1" } : {}),
        ...(view === "upvoted" ? { engagement: "upvoted" } : {}),
        ...(view === "following" ? { engagement: "following" } : {}),
      });
      return threadsApi.listThreads(base, token, params);
    },
  });

  const myThreads = useQuery({
    queryKey: [...prefix, "sidebar-mine", base, token],
    enabled: Boolean(brand.data) && Boolean(token),
    refetchInterval: PORTAL_REFRESH_INTERVAL_MS,
    retry: shouldRetry,
    queryFn: () =>
      threadsApi.listThreads(
        base,
        token,
        new URLSearchParams({ mine: "1", page: "0" }),
      ),
  });

  const updates = useQuery({
    queryKey: [...prefix, "sidebar-updates", base, token],
    enabled: Boolean(brand.data) && Boolean(token),
    refetchInterval: PORTAL_REFRESH_INTERVAL_MS,
    retry: shouldRetry,
    queryFn: () => threadsApi.getUpdates(base, token),
  });

  const detail = useQuery({
    queryKey: [...prefix, "thread", base, threadId, token, before],
    enabled: Boolean(threadId) && Boolean(brand.data),
    refetchInterval: THREAD_REFRESH_INTERVAL_MS,
    retry: shouldRetry,
    queryFn: () => threadsApi.getThread(base, threadId!, token, before),
  });

  return { brand, list, myThreads, updates, detail };
}

export function useManageThreads(token: string, filters: ManageThreadsFilters) {
  const organizationScope = authApi.getActiveOrgId() || "unknown";

  return useQuery({
    queryKey: [
      ...threadKeys.management(organizationScope),
      filters.section,
      filters.page,
      filters.search,
      filters.category,
      filters.status,
      filters.visibility,
    ],
    queryFn: () => threadsApi.getManagement(token, filters),
  });
}

type ManageThreadsMutation = {
  path: string;
  body?: unknown;
  method?: ThreadsHttpMethod;
};

export function useUpdateManageThreads(token: string) {
  const queryClient = useQueryClient();
  const organizationScope = authApi.getActiveOrgId() || "unknown";

  return useMutation({
    mutationFn: ({ path, body, method = "PATCH" }: ManageThreadsMutation) =>
      threadsApi.updateManagement(token, path, method, body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: threadKeys.management(organizationScope),
      }),
  });
}
