import { apiClient } from "@/shared/lib/api-client";
import type {
  ConversationDetailResponse,
  ConversationMessage,
  ConversationsResponse,
  RouteResponse,
  StatusResponse,
} from "../types/types";

class ConversationsApi {
  async getConversations(
    status?: string,
    options?: { assignedToMe?: boolean; unassigned?: boolean; channel?: "threads" },
  ): Promise<ConversationsResponse> {
    const params = new URLSearchParams();
    if (status && status !== "all") {
      params.set("status", status);
    }
    if (options?.assignedToMe) params.set("assignedToMe", "true");
    if (options?.unassigned) params.set("unassigned", "true");
    if (options?.channel) params.set("channel", options.channel);

    const suffix = params.toString();
    return apiClient.get<ConversationsResponse>(
      `/conversations${suffix ? `?${suffix}` : ""}`,
    );
  }

  async getConversationById(
    conversationId: string,
  ): Promise<ConversationDetailResponse> {
    return apiClient.get<ConversationDetailResponse>(
      `/conversations/${conversationId}`,
    );
  }

  async updateStatus(
    conversationId: string,
    status: string,
  ): Promise<StatusResponse> {
    return apiClient.patch<StatusResponse>(
      `/conversations/${conversationId}/status`,
      {
        status,
      },
    );
  }

  async markAsRead(conversationId: string): Promise<{ success: boolean }> {
    return apiClient.post<{ success: boolean }>(
      `/conversations/${conversationId}/read`,
    );
  }

  async routeConversation(
    conversationId: string,
    payload: { agentId?: string; reason?: string },
  ): Promise<RouteResponse> {
    return apiClient.post<RouteResponse>(
      `/conversations/${conversationId}/route`,
      payload,
    );
  }

  async getAgentRuns(conversationId: string): Promise<any> {
    return apiClient.get<any>(`/conversations/${conversationId}/agent-runs`);
  }

  async suggestReply(
    conversationId: string,
    messages?: ConversationMessage[],
  ): Promise<{ requestId: string }> {
    const response = await apiClient.post<{
      success: boolean;
      data: { requestId: string };
    }>(`/conversations/${conversationId}/ai/suggest-reply`, { messages });
    return response.data;
  }

  async generateNote(
    conversationId: string,
    messages?: ConversationMessage[],
    contactName?: string,
  ): Promise<{ requestId: string }> {
    const response = await apiClient.post<{
      success: boolean;
      data: { requestId: string };
    }>(`/conversations/${conversationId}/ai/generate-note`, {
      messages,
      contactName,
    });
    return response.data;
  }

  async assistDraft(
    conversationId: string,
    payload: { draft: string; mode: "variations" | "reframe" },
  ): Promise<{ requestId: string }> {
    const response = await apiClient.post<{
      success: boolean;
      data: { requestId: string };
    }>(`/conversations/${conversationId}/ai/draft-assist`, payload);
    return response.data;
  }

  async updateContactAssociation(
    conversationId: string,
    payload: {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      tags?: string[];
    },
  ): Promise<any> {
    return apiClient.post<any>(
      `/conversations/${conversationId}/contact`,
      payload,
    );
  }

  async getRecentConversations(): Promise<any> {
    return apiClient.get<any>("/conversations/recents");
  }
}

export const conversationsApi = new ConversationsApi();
