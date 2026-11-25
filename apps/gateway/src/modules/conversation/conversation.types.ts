export interface ListConversationsOptions {
  status?: string;
  channel?: "threads";
  limit?: number;
  offset?: number;
  assignedTo?: string | null;
  userId?: string;
}

export interface RouteConversationInput {
  agentId?: string;
  reason?: string;
}
