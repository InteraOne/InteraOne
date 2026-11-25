import type {
  ManageThreadsFilters,
  PortalBrand,
  Thread,
  ThreadDetail,
  ThreadManagement,
  ThreadsHttpMethod,
} from "../types/types";

const defaultApi =
  (import.meta.env.VITE_API_URL || "http://localhost:3002/api/v1") + "/threads";

class PortalRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function portalErrorStatus(error: unknown) {
  return error instanceof PortalRequestError ? error.status : undefined;
}

async function response(
  path: string,
  token: string,
  method: ThreadsHttpMethod,
  body?: unknown,
) {
  const customHost = path === "/host" || path.startsWith("/host/");
  const api = customHost ? "/api/v1/threads" : defaultApi;
  const r = await fetch(api + path, {
    method,
    cache: "no-store",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok)
    throw new PortalRequestError(
      (await r.json().catch(() => ({}))).message || "Request failed",
      r.status,
    );
  return r;
}
async function request<T>(
  path: string,
  token = "",
  method: ThreadsHttpMethod = "GET",
  body?: unknown,
): Promise<T> {
  const r = await response(path, token, method, body);
  return r.status === 204 ? (undefined as T) : r.json();
}

function portalThreadPath(base: string, threadId: string) {
  return `${base}/threads/${encodeURIComponent(threadId)}`;
}

export const threadsApi = {
  getHostBrand: () => request<PortalBrand>("/host"),

  getPortalBrand: (base: string) => request<PortalBrand>(base),

  listThreads: (base: string, token: string, params: URLSearchParams) =>
    request<Thread[]>(`${base}/threads?${params}`, token),

  getUpdates: (base: string, token: string) =>
    request<Thread[]>(`${base}/updates`, token),

  getThread: (base: string, threadId: string, token: string, before?: string) =>
    request<ThreadDetail>(
      `${portalThreadPath(base, threadId)}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      token,
    ),

  findSimilar: (base: string, token: string, title: string) =>
    request<Thread[]>(
      `${base}/similar?title=${encodeURIComponent(title.trim())}`,
      token,
    ),

  requestAttachmentUpload: (
    base: string,
    token: string,
    file: { fileName: string; mimeType: string; size: number },
  ) =>
    request<{ uploadUrl: string; key: string; name: string }>(
      `${base}/attachments`,
      token,
      "POST",
      file,
    ),

  sendSignInCode: (base: string, email: string) =>
    request<void>(`${base}/code`, "", "POST", { email }),

  createSession: (
    base: string,
    email: string,
    code: FormDataEntryValue | null,
  ) =>
    request<{ token: string }>(`${base}/session`, "", "POST", { email, code }),

  deleteSession: (base: string, token: string) =>
    request<void>(`${base}/session`, token, "DELETE"),

  createThread: (
    base: string,
    token: string,
    payload: Record<string, unknown>,
  ) => request<{ id: string }>(`${base}/threads`, token, "POST", payload),

  createReply: (
    base: string,
    threadId: string,
    token: string,
    payload: Record<string, unknown>,
  ) =>
    request<{ id: string }>(
      `${portalThreadPath(base, threadId)}/replies`,
      token,
      "POST",
      payload,
    ),

  vote: (base: string, threadId: string, token: string, voted: boolean) =>
    request<void>(`${portalThreadPath(base, threadId)}/vote`, token, "PUT", {
      voted,
    }),

  toggleReaction: (
    base: string,
    threadId: string,
    messageId: string,
    token: string,
    emoji: string,
    reacted: boolean,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      token,
      "PUT",
      { emoji, reacted },
    ),

  follow: (base: string, threadId: string, token: string, following: boolean) =>
    request<void>(`${portalThreadPath(base, threadId)}/follow`, token, "PUT", {
      following,
    }),

  updateReply: (
    base: string,
    threadId: string,
    replyId: string,
    token: string,
    text: string,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/replies/${encodeURIComponent(replyId)}`,
      token,
      "PATCH",
      { text },
    ),

  deleteReply: (
    base: string,
    threadId: string,
    replyId: string,
    token: string,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/replies/${encodeURIComponent(replyId)}`,
      token,
      "DELETE",
    ),

  acceptSolution: (
    base: string,
    threadId: string,
    replyId: string,
    token: string,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/solution`,
      token,
      "PUT",
      {
        replyId,
      },
    ),

  reportReply: (
    base: string,
    threadId: string,
    replyId: string,
    token: string,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/replies/${encodeURIComponent(replyId)}/report`,
      token,
      "POST",
    ),

  escalate: (base: string, threadId: string, token: string) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/escalate`,
      token,
      "POST",
    ),

  updateStatus: (
    base: string,
    threadId: string,
    token: string,
    status: string,
  ) =>
    request<void>(
      `${portalThreadPath(base, threadId)}/status`,
      token,
      "PATCH",
      {
        status,
      },
    ),

  getAttachmentUrl: (
    base: string,
    threadId: string,
    token: string,
    key: string,
  ) =>
    request<{ url: string }>(
      `${portalThreadPath(base, threadId)}/attachments?key=${encodeURIComponent(key)}`,
      token,
    ),

  getManagement: (token: string, filters: ManageThreadsFilters) => {
    const params = new URLSearchParams({
      page: String(filters.page),
      ...(filters.search ? { q: filters.search } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.visibility ? { visibility: filters.visibility } : {}),
      ...(filters.section === "moderation" ? { scope: "moderation" } : {}),
    });
    return request<ThreadManagement>(`/manage?${params}`, token);
  },

  updateManagement: (
    token: string,
    path: string,
    method: ThreadsHttpMethod,
    body?: unknown,
  ) => request(`/manage${path}`, token, method, body),
};
