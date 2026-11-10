import { Request, Response } from "express";
import { asyncHandler, sendError, sendResponse } from "@shared/core/response";
import { AuthenticatedRequest } from "@shared/security/middleware";
import { TicketsService } from "./tickets.service";
import { ChannelService } from "../channels/channels.service";
import { User } from "@shared/models";

const service = new TicketsService();

const getOrgId = (req: Request): string =>
  (req as AuthenticatedRequest).user.activeOrganizationId;

const param = (req: Request, key: string): string => String(req.params[key] || "");

// ─── Agent UI Endpoints ──────────────────────────────────────────────────────

export const listTickets = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const result = await service.listTickets(getOrgId(req), {
    status: q.status || undefined,
    priority: q.priority || undefined,
    assignedTo: q.assignedTo || undefined,
    limit: q.limit ? Number(q.limit) : 50,
    page: q.page ? Number(q.page) : 1,
  });
  sendResponse(res, 200, true, "Tickets fetched", result);
});

export const getTicketById = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.getTicketById(getOrgId(req), param(req, "ticketId"));
  if (!ticket) return sendError(res, 404, "Ticket not found");
  sendResponse(res, 200, true, "Ticket fetched", { ticket });
});

export const createTicketAgent = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId, contactId, title, description, priority, tags, source } = req.body;
  const ticket = await service.createTicket({
    organizationId: getOrgId(req),
    conversationId,
    contactId,
    title,
    description,
    priority,
    source: source || "agent",
    tags,
  });
  sendResponse(res, 201, true, "Ticket created", { ticket });
});

export const updateTicketAgent = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.updateTicket(getOrgId(req), param(req, "ticketId"), req.body);
  if (!ticket) return sendError(res, 404, "Ticket not found");
  sendResponse(res, 200, true, "Ticket updated", { ticket });
});

export const addNoteAgent = asyncHandler(async (req: Request, res: Response) => {
  const { content } = req.body;
  const authReq = req as AuthenticatedRequest;
  const ticket = await service.addNote(
    getOrgId(req),
    param(req, "ticketId"),
    content,
    authReq.user.email || "Agent",
  );
  if (!ticket) return sendError(res, 404, "Ticket not found");
  sendResponse(res, 200, true, "Note added", { ticket });
});

// ─── AI-Internal Endpoints (x-ai-tool-secret) ───────────────────────────────

export const aiCreateTicket = asyncHandler(async (req: Request, res: Response) => {
  const {
    organizationId,
    conversationId,
    contactId,
    title,
    description,
    priority,
    status,
    requesterName,
    requesterEmail,
    tags,
    idempotencyKey,
  } = req.body;
  const ticket = await service.createTicket({
    organizationId,
    conversationId,
    contactId,
    title,
    description,
    priority,
    status,
    requesterName,
    requesterEmail,
    source: "ai",
    tags,
    idempotencyKey,
  });
  sendResponse(res, 201, true, "Ticket created by AI", { ticket });
});

export const aiUpdateTicket = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, ...rest } = req.body;
  const ticket = await service.updateTicket(organizationId, param(req, "ticketId"), rest);
  if (!ticket) return sendError(res, 404, "Ticket not found");
  sendResponse(res, 200, true, "Ticket updated by AI", { ticket });
});

export const aiGetTicketStatus = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, ticketIdentifier } = req.query as Record<string, string>;

  if (!organizationId || !ticketIdentifier) {
    return sendError(res, 400, "organizationId and ticketIdentifier are required");
  }

  const ticket = await service.getTicketStatus(organizationId, ticketIdentifier);
  if (!ticket) return sendError(res, 404, "No ticket found for that identifier");
  sendResponse(res, 200, true, "Ticket status fetched", { ticket });
});

export const aiCloseTicket = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, resolutionNote } = req.body;
  const ticket = await service.closeTicket(organizationId, param(req, "ticketId"), { resolutionNote });
  if (!ticket) return sendError(res, 404, "Ticket not found");
  sendResponse(res, 200, true, "Ticket closed by AI", { ticket });
});

// ─── Agent UI: reply to customer ────────────────────────────────────────────

export const replyToTicket = asyncHandler(async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const ticketId = param(req, "ticketId");
  const { content } = req.body;
  const idempotencyKey = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim();

  if (!idempotencyKey) {
    return sendError(res, 400, "Idempotency-Key header or idempotencyKey is required");
  }

  // Verify ticket exists and belongs to this org
  const ticket = await service.getTicketById(orgId, ticketId);
  if (!ticket) return sendError(res, 404, "Ticket not found");

  const user = (req as AuthenticatedRequest).user;
  const userDoc = await User.findById(user.userId).select("name").lean();
  const result = await ChannelService.sendTicketFollowup(
    orgId,
    ticketId,
    content,
    {
      userId: user.userId,
      name: userDoc?.name || "Agent",
      email: user.email || "",
    },
    idempotencyKey,
  );

  if (!result.success) {
    const statusCode =
      result.errorCode === "TICKET_NOT_FOUND"
        ? 404
        : result.errorCode === "IDEMPOTENCY_CONFLICT" || result.errorCode === "REQUEST_IN_PROGRESS"
          ? 409
          : result.errorCode === "INVALID_RECIPIENT"
            ? 400
            : result.errorCode === "EMAIL_CHANNEL_NOT_FOUND"
              ? 409
              : result.errorCode === "EMAIL_SEND_FAILED"
                ? 502
                : 500;
    return sendError(res, statusCode, result.error || "Failed to send reply");
  }

  sendResponse(
    res,
    200,
    true,
    result.duplicate ? "Reply was already processed" : "Reply sent to customer via email",
    result,
  );
});
