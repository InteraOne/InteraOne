import { apiClient } from "@/shared/lib/api-client";
import type {
  ListTicketsResponse,
  TicketResponse,
  CreateTicketData,
  UpdateTicketData,
} from "../types/types";

class TicketsApi {
  async listTickets(filters: {
    status?: string;
    priority?: string;
    assignedTo?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<ListTicketsResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.append("status", filters.status);
    if (filters.priority) params.append("priority", filters.priority);
    if (filters.assignedTo) params.append("assignedTo", filters.assignedTo);
    if (filters.page) params.append("page", String(filters.page));
    if (filters.limit) params.append("limit", String(filters.limit));

    const queryString = params.toString();
    const endpoint = `/tickets${queryString ? `?${queryString}` : ""}`;
    return apiClient.get<ListTicketsResponse>(endpoint);
  }

  async getTicket(ticketId: string): Promise<TicketResponse> {
    return apiClient.get<TicketResponse>(`/tickets/${ticketId}`);
  }

  async createTicket(data: CreateTicketData): Promise<TicketResponse> {
    return apiClient.post<TicketResponse>("/tickets", data);
  }

  async updateTicket(ticketId: string, data: UpdateTicketData): Promise<TicketResponse> {
    return apiClient.patch<TicketResponse>(`/tickets/${ticketId}`, data);
  }

  async addNote(ticketId: string, content: string): Promise<TicketResponse> {
    return apiClient.post<TicketResponse>(`/tickets/${ticketId}/notes`, { content });
  }

  async assignTicket(ticketId: string, memberId: string | null): Promise<TicketResponse> {
    return this.updateTicket(ticketId, { assignedTo: memberId });
  }

  async updateStatus(ticketId: string, status: "open" | "in_progress" | "resolved" | "closed"): Promise<TicketResponse> {
    return this.updateTicket(ticketId, { status });
  }

  async replyToTicket(
    ticketId: string,
    content: string,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<void> {
    return apiClient.post(`/tickets/${ticketId}/reply`, { content, idempotencyKey });
  }
}

export const ticketsApi = new TicketsApi();
