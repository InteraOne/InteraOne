import { notifyThreadOwner } from "@modules/threads/notifications";
import { handoffThread } from "@modules/threads/handoff";
import { Request, Response } from "express";
import { Types } from "mongoose";
import { asyncHandler, sendError, sendResponse } from "@shared/core/response";
import { ConversationService } from "./conversation.service";
import { AuthenticatedRequest } from "@shared/security/middleware/auth";
import { Contact, Message, Conversation, Organization } from "@shared/models";
import { socketService } from "@sockets/services/socket.service";
import logger from "@shared/core/logger";
import { tracker } from "@shared/utils/tracker";
import { ChannelService } from "../channels/channels.service";

const conversationService = new ConversationService();

const getOrgId = (req: Request): string =>
  (req as AuthenticatedRequest).user.activeOrganizationId;

// ─── GET all conversations ──────────────────────────────────────────────────────

export const getConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      status,
      channel,
      limit = 50,
      offset = 0,
      assignedToMe,
      unassigned,
    } = req.query;
    const { userId, orgRole } = (req as AuthenticatedRequest).user;

    let assignedTo: string | null | undefined = undefined;

    if (unassigned === "true") {
      assignedTo = null; // Explicitly null for unassigned
    } else if (assignedToMe === "true") {
      assignedTo = userId;
    }

    const result = await conversationService.getConversations(getOrgId(req), {
      status: status as string,
      channel: channel === "threads" ? channel : undefined,
      limit: Number(limit),
      offset: Number(offset),
      assignedTo,
      userId,
    });

    sendResponse(res, 200, true, "Conversations fetched successfully", result);
  },
);

// ─── GET single conversation ────────────────────────────────────────────────────

export const getConversationById = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const userId = (req as AuthenticatedRequest).user.userId;
    const orgId = getOrgId(req);
    const result = await conversationService.getConversationById(
      orgId,
      conversationId,
    );
    if (!result) return sendError(res, 404, "Conversation not found");

    sendResponse(res, 200, true, "Conversation fetched successfully", result);
  },
);

export const markConversationRead = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { userId } = (req as AuthenticatedRequest).user;
    const orgId = getOrgId(req);

    const conversation = await conversationService.markConversationRead(
      orgId,
      conversationId,
      userId,
    );

    if (!conversation) return sendError(res, 404, "Conversation not found");

    sendResponse(res, 200, true, "Conversation marked as read", {
      conversationId,
    });
  },
);

export const suggestReply = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const organizationId = getOrgId(req);
    const userId = (req as AuthenticatedRequest).user.userId;
    const data = await conversationService.suggestReply(
      organizationId,
      conversationId,
      userId,
    );

    if (!data) return sendError(res, 404, "Conversation not found");

    sendResponse(
      res,
      200,
      true,
      "Reply suggestions generation initiated successfully",
      data,
    );
  },
);

export const generateNote = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const organizationId = getOrgId(req);
    const userId = (req as AuthenticatedRequest).user.userId;
    const data = await conversationService.generateNote(
      organizationId,
      conversationId,
      userId,
      req.body?.contactName,
    );

    if (!data) return sendError(res, 404, "Conversation not found");

    sendResponse(
      res,
      200,
      true,
      "CRM note generation initiated successfully",
      data,
    );
  },
);

export const assistDraft = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = req.params.conversationId as string;
  const organizationId = getOrgId(req);
  const userId = (req as AuthenticatedRequest).user.userId;
  const data = await conversationService.assistDraft(
    organizationId,
    conversationId,
    userId,
    {
      draft: req.body?.draft,
      mode: req.body?.mode,
    },
  );

  if (!data) return sendError(res, 404, "Conversation not found");

  sendResponse(
    res,
    200,
    true,
    "Draft assistance generation initiated successfully",
    data,
  );
});

// ─── Route conversation ─────────────────────────────────────────────────────────

export const routeConversation = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { agentId, reason } = req.body;
    const orgId = getOrgId(req);

    if (!agentId) return sendError(res, 400, "agentId must be provided");

    const result = await conversationService.routeConversation(
      orgId,
      conversationId,
      { agentId, reason },
      (req as AuthenticatedRequest).user.userId,
    );

    if (!result.found) return sendError(res, 404, "Conversation not found");
    if (result.noAgent) return sendError(res, 404, "No available agents");
    if (result.agentNotFound) return sendError(res, 404, "Agent not found");

    if (result.selectedAgentId) {
      try {
        const payload = {
          conversationId: result.originalConversation!._id,
          subject: result.originalConversation!.subject,
          routedTo: result.selectedAgentId,
          agentName: result.agentName,
          reason: reason || "Manual routing",
          timestamp: new Date(),
        };

        socketService.emitToConversation(conversationId, "conversation_escalated", {
          conversationId,
          reason: reason || "Transferred to another agent",
          agent: {
            id: result.selectedAgentId.toString(),
            name: result.agentName,
            email: result.agentEmail,
          },
        });

        // Broadcast to the whole organization so other agents' inbox lists refresh in real-time
        socketService.emitToOrg(orgId, "conversation_assigned", { conversationId });
        socketService.emitToOrg(orgId, "conversation_escalated", { conversationId });

        // Notify the old agent that the conversation was removed from their queue
        const oldAgentId = result.originalConversation!.assignedTo;
        if (
          oldAgentId &&
          oldAgentId.toString() !== result.selectedAgentId.toString()
        ) {
          socketService.emitToUser(oldAgentId.toString(), "conversation_removed", {
            conversationId,
          });
        }

        // Notify the newly assigned agent directly so their inbox highlights immediately
        socketService.emitToUser(result.selectedAgentId.toString(), "assigned_to_you", {
          conversationId,
          type: "conversation",
          routedBy: (req as AuthenticatedRequest).user.email,
        });

      } catch (err: any) {
        logger.error(`Failed to emit routing notification: ${err?.message}`);
      }
    }

    sendResponse(res, 200, true, "Conversation routed successfully", {
      conversationId: result.updatedConversation?._id,
      assignedTo: result.updatedConversation?.assignedTo,
      agentName: result.agentName,
    });

    if (result.updatedConversation?._id && result.selectedAgentId) {
      tracker.trackEvent(
        orgId,
        "agent_assigned",
        "system",
        { reason: reason || "manual_routing" },
        {
          conversationId: result.updatedConversation._id.toString(),
          agentId: result.selectedAgentId.toString(),
          channel: "web",
        },
      );
    }
  },
);

// ─── Update conversation status (full) ──────────────────────────────────────────

export const updateConversationStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { status } = req.body;
    const orgId = getOrgId(req);

    const result = await conversationService.updateConversationStatus(
      orgId,
      conversationId,
      status,
      (req as AuthenticatedRequest).user.userId,
    );

    if (!result.valid)
      return sendError(
        res,
        400,
        "Status must be one of: open, pending, closed, resolved",
      );
    if (!result.found) return sendError(res, 404, "Conversation not found");

    socketService.getIO()
      .to(`org:${orgId}:conv:${conversationId}`)
      .emit("status_updated", {
        conversationId: result.conversation!._id,
        status,
        updatedBy: (req as any).user?.name || "Agent",
        timestamp: new Date(),
      });

    // Broadcast to the whole organization so other agents' inbox lists refresh in real-time
    socketService.emitToOrg(orgId, "status_updated", {
      conversationId: result.conversation!._id,
      status,
      updatedBy: (req as any).user?.name || "Agent",
      timestamp: new Date(),
    });

    sendResponse(res, 200, true, "Status updated successfully", {
      conversationId: result.conversation!._id,
      status: result.conversation!.status,
    });

    if (result.conversation) void notifyThreadOwner(result.conversation, "status");

    if (status === "closed" || status === "resolved") {
      tracker.trackEvent(
        orgId,
        status === "closed" ? "conversation_closed" : "conversation_resolved",
        "agent",
        { updatedBy: (req as AuthenticatedRequest).user.userId },
        {
          conversationId: result.conversation!._id.toString(),
          agentId: (req as AuthenticatedRequest).user.userId,
          channel: "web",
        },
      );
    }
  },
);

// ─── AI-Internal: Conversation Gate (status/escalation check) ───────────────

export const aiGetConversationGate = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { organizationId } = req.query as Record<string, string>;

    if (!organizationId)
      return sendError(res, 400, "organizationId is required");

    const conv = await conversationService.getConversationGate(
      organizationId,
      conversationId,
    );
    if (!conv) return sendError(res, 404, "Conversation not found");

    sendResponse(res, 200, true, "Conversation gate fetched", { gate: conv });
  },
);

// ─── AI-Internal: Mark Query Resolved ────────────────────────────────────────

export const aiResolveConversation = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { organizationId, resolutionEntry } = req.body;

    if (!organizationId)
      return sendError(res, 400, "organizationId is required");
    if (!resolutionEntry)
      return sendError(res, 400, "resolutionEntry is required");

    const result = await conversationService.markQueryResolved(
      organizationId,
      conversationId,
      resolutionEntry,
    );

    if (!result) return sendError(res, 404, "Conversation not found");

    sendResponse(res, 200, true, "Query marked as resolved", {
      resolutionId: resolutionEntry.id,
    });
  },
);

// ─── AI-Internal: Conversation Memory ────────────────────────────────────────

export const aiGetMemory = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = req.params.conversationId as string;
  const { organizationId, limit } = req.query as Record<string, string>;

  if (!organizationId) return sendError(res, 400, "organizationId is required");

  const result = await conversationService.getConversationMemory(
    organizationId,
    conversationId,
    Number(limit) || 10,
  );

  sendResponse(res, 200, true, "Conversation memory fetched", result);
});

// ─── AI-Internal: Escalate to Human ──────────────────────────────────────────

export const aiEscalate = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = req.params.conversationId as string;
  const { organizationId, reason, agentId, unassigned } = req.body;

  if (!organizationId) return sendError(res, 400, "organizationId is required");

  // Fetch conversation first to resolve channel details for outbound notifications
  const conv = await Conversation.findOne({ _id: conversationId, organizationId })
    .select("channel channelId sessionId metadata subject status assignedTo")
    .lean();

  if (!conv) return sendError(res, 404, "Conversation not found");
  if (conv.channel === "threads") {
    if (conv.metadata?.thread?.category !== "support")
      return sendError(res, 404, "Conversation not found");
    await handoffThread(organizationId, conversationId, reason || "AI requested the support team");
    return sendResponse(res, 200, true, "Escalated to human support", {
      conversationId,
      assignedAgent: conv.assignedTo?.toString() || null,
      status: conv.status,
    });
  }

  let bodyText = "";
  if (conv && conv.channel === "email_channel") {
    const contact = await Contact.findOne({ sessionId: conv.sessionId, organizationId }).lean();
    const recipientName = contact?.name && contact.name !== "Anonymous User" ? contact.name : "there";
    const recipientEmail = contact?.email || (conv.metadata as any)?.senderEmail || conv.sessionId?.replace("email-", "");
    const organization = await Organization.findById(organizationId).lean();
    const company = organization?.name || "Support";

    bodyText = `Dear ${recipientName},

I've saved your contact details so the right team member can follow up with you.

Your inquiry has been noted and will be assigned to a member of our team. They'll be reaching out to you at ${recipientEmail} shortly.

If you want to continue talking with me, please create a new email instead of replying to this thread. This thread is now connected to a human agent who will continue the conversation; the AI assistant is only available on a new email thread.

If there's anything else I can help you with in the meantime, please don't hesitate to let me know.

Best regards,
the ${company} Team`;
  }

  const notifyChannel = async (messageText: string) => {
    if (conv && conv.channel && conv.channelId) {
      let to: string | undefined;
      const convMeta = (conv.metadata as any) || {};

      if (conv.channel === "email_channel") {
        to = convMeta.senderEmail || conv.sessionId?.replace("email-", "");
      } else if (conv.channel === "whatsapp_channel") {
        to = convMeta.phone || conv.sessionId?.replace("whatsapp-", "");
      } else if (conv.channel === "telegram_channel") {
        to = convMeta.chatId || conv.sessionId?.replace("telegram-", "");
      }

      if (to) {
        try {
          await ChannelService.sendViaChannel(organizationId, conv.channelId.toString(), {
            to,
            subject: conv.subject || "Support Status Update",
            body: messageText,
            from: convMeta.supportEmail,
          });
        } catch (err: any) {
          logger.error("[AI Escalate] Failed to send escalation notification to channel:", err.message);
        }
      }
    }
  };

  // Determine if we should attempt auto-assignment
  let resolvedAgentId = agentId;
  if (!unassigned && !resolvedAgentId) {
    const autoAssign =
      await conversationService.autoAssignConversation(organizationId);
    resolvedAgentId = autoAssign.agentId || undefined;
  }

  // PATH A: Route to an online agent
  if (resolvedAgentId) {
    const result = await conversationService.routeConversation(
      organizationId,
      conversationId,
      { agentId: resolvedAgentId, reason },
      "ai_tool",
    );

    if (!result.found) return sendError(res, 404, "Conversation not found");

    // Set status to open
    await conversationService.updateConversationStatus(
      organizationId,
      conversationId,
      "open",
      "ai_tool",
    );

    // Fire real-time events for assigned agent & conversation room
    if (result.selectedAgentId) {
      try {
        socketService.emitToConversation(conversationId, "conversation_escalated", {
          conversationId,
          reason: reason || "AI escalated this conversation to a human agent",
          agent: {
            id: result.selectedAgentId.toString(),
            name: result.agentName,
            email: result.agentEmail,
          },
        });

        // Broadcast to the whole organization so other agents' inbox lists refresh in real-time
        socketService.emitToOrg(organizationId, "conversation_assigned", { conversationId });
        socketService.emitToOrg(organizationId, "conversation_escalated", { conversationId });
      } catch (err: any) {
        logger.error(`[AI Escalate] Socket emit failed: ${err?.message}`);
      }
    }

    // Send Telegram/WhatsApp/Email notification to user
    await notifyChannel(bodyText || `You are being connected to ${result.agentName || "a support agent"}.`);

    return sendResponse(res, 200, true, "Escalated to human agent", {
      conversationId,
      assignedAgent: result.selectedAgentId?.toString() || null,
      agentName: result.agentName || null,
      status: "open",
    });
  }

  // PATH B: Escalated as Unassigned (both AI is disabled, or no agents are online)
  // Create and save an elegant system/backlog escalation notification message
  const supportMsg = new Message({
    organizationId,
    conversationId,
    senderId: "support-team",
    content: bodyText || "Our team will get back to you shortly.",
    type: "text",
    metadata: {
      senderName: "Support Team",
      senderEmail: "support@interaone.internal",
      source: "system",
    },
  });
  await supportMsg.save();

  // Update conversation record to be open and unassigned
  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      status: "open",
      assignedTo: null,
      "metadata.escalatedAt": new Date(),
      "metadata.escalationReason": reason,
      "metadata.pendingEscalation": false,
    },
  });

  // Send Telegram/WhatsApp/Email notification to user
  await notifyChannel(bodyText || "Our team will get back to you shortly.");

  // Notify organization room so lists refresh in real-time
  socketService.getIO().to(`org:${organizationId}`).emit("conversation_pending", {
    conversationId,
    reason: reason || "AI escalated — awaiting agent",
  });
  socketService.emitToConversation(conversationId, "status_updated", {
    conversationId,
    status: "open",
  });
  socketService.emitToConversation(conversationId, "new_message", {
    conversationId,
    message: {
      _id: supportMsg._id,
      senderId: supportMsg.senderId,
      content: supportMsg.content,
      type: supportMsg.type,
      metadata: supportMsg.metadata,
      createdAt: supportMsg.createdAt,
    },
  });

  return sendResponse(
    res,
    200,
    true,
    "Escalated to human backlog (unassigned)",
    {
      conversationId,
      assignedAgent: null,
      agentName: null,
      status: "open",
    },
  );
});

// ─── Save Agent Run (AI-Internal) ───────────────────────────────────────────────

export const aiSaveAgentRun = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const { organizationId, messageId, steps, duration, status, error, usage } =
      req.body;

    if (!organizationId || !messageId || duration === undefined || !status) {
      return sendError(res, 400, "Missing required fields");
    }

    const result = await conversationService.createAgentRun({
      organizationId,
      conversationId,
      messageId,
      steps: steps || [],
      duration,
      status,
      error,
      usage,
    });

    sendResponse(res, 201, true, "Agent run logged successfully", result);
  },
);

// ─── Get Agent Runs (Agent/Admin Dashboard) ─────────────────────────────────────

export const getAgentRuns = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const orgId = getOrgId(req);

    const runs = await conversationService.getAgentRuns(orgId, conversationId);
    sendResponse(res, 200, true, "Agent runs fetched successfully", runs);
  },
);

export const aiCloseInactiveConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const { inactivityLimitMs } = req.body;
    const result =
      await conversationService.closeInactiveConversations(inactivityLimitMs);
    sendResponse(
      res,
      200,
      true,
      "Inactive conversations scanned and closed",
      result,
    );
  },
);

export const aiGetPendingAnalysisConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await conversationService.getPendingAnalysisConversations();
    sendResponse(
      res,
      200,
      true,
      "Pending analysis conversations fetched successfully",
      result,
    );
  },
);

export const updateContactAssociation = asyncHandler(
  async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId as string;
    const organizationId = getOrgId(req);
    const { name, email, phone, company, tags } = req.body;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      organizationId,
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    const sessionId = conversation.sessionId || `conv:${conversationId}`;
    let contact = null;

    // 1. If email is provided, check if a contact already exists with that email
    if (email && email.trim() !== "") {
      const trimmedEmail = email.trim().toLowerCase();
      contact = await Contact.findOne({
        organizationId,
        email: trimmedEmail,
      });

      if (contact) {
        // Attach/merge existing contact to this conversation by matching session ID
        contact.sessionId = sessionId;
        contact.conversationId = new Types.ObjectId(conversationId);
        if (name) contact.name = name.trim();
        if (phone) contact.phone = phone.trim();
        if (company) contact.company = company.trim();
        if (tags) contact.tags = tags;
        await contact.save();
      }
    }

    // 2. If no contact was found by email, check if one already exists with the current sessionId
    if (!contact) {
      contact = await Contact.findOne({
        organizationId,
        sessionId,
      });

      if (contact) {
        // Update its fields
        if (name) contact.name = name.trim();
        if (email) contact.email = email.trim().toLowerCase();
        if (phone) contact.phone = phone.trim();
        if (company) contact.company = company.trim();
        if (tags) contact.tags = tags;
        await contact.save();
      } else {
        // 3. Create a brand new contact linked to this conversation session
        contact = await Contact.create({
          organizationId,
          sessionId,
          conversationId: new Types.ObjectId(conversationId),
          name: name ? name.trim() : "Anonymous User",
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          company: company ? company.trim() : undefined,
          tags: tags || [],
          source: "agent",
          lastActivityAt: new Date(),
        });
      }
    }

    // Also sync key conversation metadata
    const conversationUpdate: Record<string, any> = {};
    if (contact.name) conversationUpdate["metadata.senderName"] = contact.name;
    if (contact.email)
      conversationUpdate["metadata.senderEmail"] = contact.email;
    if (contact.phone)
      conversationUpdate["metadata.visitorPhone"] = contact.phone;

    if (Object.keys(conversationUpdate).length > 0) {
      await Conversation.updateOne(
        { _id: conversationId },
        { $set: conversationUpdate },
      );
    }

    // Emit socket changes so the frontend UI re-fetches or updates
    try {
      socketService.emitToConversation(conversationId, "conversation_updated", {
        conversationId,
        contact: {
          id: contact._id.toString(),
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          company: contact.company,
        },
      });
    } catch (err: any) {
      logger.error(`Failed to emit contact update socket: ${err?.message}`);
    }

    sendResponse(res, 200, true, "Contact associated successfully", {
      contact: {
        id: contact._id.toString(),
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
      },
    });
  },
);

// ─── GET recent conversations ──────────────────────────────────────────────────

export const getRecentConversations = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.userId;
    const orgId = getOrgId(req);
    const results = await conversationService.getRecentConversations(
      userId,
      orgId,
    );
    sendResponse(
      res,
      200,
      true,
      "Recent conversations fetched successfully",
      results,
    );
  },
);
