import { internalApi } from "./internal.client";

export interface SyncInfoResponse {
  _id: string;
  organizationId: string;
  title: string;
  source: string;
  sourceUrl?: string;
  fetchMode?: string;
  crawlDepth?: number;
  syncFrequency?: string;
  isPaused?: boolean;
}

export interface IngestionStatusUpdate {
  status: "indexing" | "indexed" | "failed";
  wordCount?: number;
  chunkCount?: number;
  lastIndexed?: Date;
  errorMessage?: string;
  failedChunkCount?: number;
  totalChunkCount?: number;
}

export const InternalApiService = {
  async openComposioSession(
    organizationId: string,
    conversationId: string,
    channel: "widget" | "email" | "whatsapp" | "telegram" = "widget",
  ): Promise<any> {
    const { data } = await internalApi.post("/integrations/ai/session", {
      organizationId,
      conversationId,
      channel,
    });
    return data?.data;
  },

  async executeComposioSessionTool(payload: {
    organizationId: string;
    conversationId: string;
    sessionId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }): Promise<any> {
    const { data } = await internalApi.post(
      "/integrations/ai/session/execute",
      payload,
    );
    return data?.data ?? data;
  },

  /**
   * Fetch sync metadata/info for a document
   */
  async getSyncInfo(
    documentId: string,
    organizationId: string,
  ): Promise<SyncInfoResponse | null> {
    const { data } = await internalApi.get(
      `/knowledge/ai/${documentId}/sync-info`,
      {
        params: { organizationId },
      },
    );
    return data?.data ?? null;
  },

  /**
   * Update the status and metrics of a document ingestion job
   */
  async updateIngestionStatus(
    organizationId: string,
    documentId: string,
    update: IngestionStatusUpdate,
  ): Promise<void> {
    await internalApi.patch(`/knowledge/ai/${documentId}/status`, {
      organizationId,
      ...update,
      lastIndexed: update.lastIndexed?.toISOString(),
    });
  },

  /**
   * Send a system/AI status notification to the gateway
   */
  async sendNotification(
    organizationId: string,
    type: string,
    title: string,
    description: string,
  ): Promise<void> {
    await internalApi.post("/notifications/ai", {
      organizationId,
      type,
      title,
      description,
    });
  },

  /**
   * Fetch conversation gate properties (status, assignment, escalation details)
   */
  async getConversationGate(
    conversationId: string,
    organizationId: string,
  ): Promise<any> {
    const { data } = await internalApi.get(
      `/conversations/ai/${conversationId}/gate`,
      {
        params: { organizationId },
      },
    );
    return data?.data?.gate ?? null;
  },

  /**
   * Save agent run execution steps and statistics
   */
  async saveAgentRunLogs(
    conversationId: string,
    payload: {
      organizationId: string;
      messageId: string;
      steps: any[];
      duration: number;
      status: "success" | "failed";
      error?: string;
      usage?: any;
    },
  ): Promise<void> {
    await internalApi.post(
      `/conversations/ai/${conversationId}/agent-runs`,
      payload,
    );
  },

  /**
   * Escalate a conversation to a human agent
   */
  async escalateConversation(
    conversationId: string,
    payload: {
      organizationId: string;
      reason: string;
      unassigned?: boolean;
    },
  ): Promise<void> {
    await internalApi.post(
      `/conversations/ai/${conversationId}/escalate`,
      payload,
    );
  },
};
