import { Types } from "mongoose";
import {
  Conversation,
  Message,
  User,
  Membership,
  SystemEvent,
  Ticket,
  Contact,
} from "@shared/models";
import { socketService } from "@sockets/services/socket.service";
import logger from "@shared/core/logger";
import {
  ListConversationsOptions,
  RouteConversationInput,
} from "./conversation.types";
import { assistQueue } from "@shared/infra/queue";

const INBOX_QUEUE_CONDITIONS = [
  { channel: "threads" },
  { "metadata.escalatedAt": { $ne: null } },
  { "metadata.pendingEscalation": true },
];

function toAssistMessages(messages: any[]) {
  return messages.map((message) => ({
    role:
      message.metadata?.source === "web" ||
      message.metadata?.source === "ai" ||
      message.senderId === "ai-bot"
        ? "assistant"
        : "user",
    content: message.content,
    senderName: message.metadata?.senderName,
    source: message.metadata?.source,
  }));
}

export class ConversationService {
  /**
   * Get all conversations for an organization (filtered by status/agent)
   */
  async getConversations(
    organizationId: string,
    options: ListConversationsOptions,
  ) {
    const { status, channel, limit = 50, offset = 0, assignedTo, userId } = options;

    const filter: any = { organizationId, ...(channel && { channel }) };

    if (assignedTo === null) {
      filter.assignedTo = null;
      filter.$or = INBOX_QUEUE_CONDITIONS;
    } else if (assignedTo) {
      // Specifically requesting conversations for a certain agent
      filter.assignedTo = assignedTo;
    } else {
      // Include assigned conversations and anything visible in the queue.
      filter.$or = [
        { assignedTo: { $ne: null } },
        ...INBOX_QUEUE_CONDITIONS,
      ];
    }

    if (status && status !== "all") filter.status = status;

    const conversations = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .limit(Number(limit))
      .skip(Number(offset))
      .lean();

    const conversationIds = conversations.map((c) => c._id);
    const orgIdObj = new Types.ObjectId(organizationId);
    const unreadMessageFilters = conversations.map((conv) => {
      const readAt = userId
        ? (conv.metadata as any)?.agentReads?.[userId]?.lastReadAt
        : null;
      const readDate = readAt ? new Date(readAt) : null;

      return {
        conversationId: conv._id,
        ...(readDate && !Number.isNaN(readDate.getTime())
          ? { createdAt: { $gt: readDate } }
          : {}),
      };
    });

    const [latestMessages, unreadCounts] = await Promise.all([
      Message.aggregate([
        {
          $match: {
            conversationId: { $in: conversationIds },
            organizationId: orgIdObj,
          },
        },
        {
          $sort: { conversationId: 1, createdAt: -1 },
        },
        {
          $group: {
            _id: "$conversationId",
            message: { $first: "$$ROOT" },
          },
        },
      ]),
      Message.aggregate([
        {
          $match: {
            organizationId: orgIdObj,
            "metadata.source": { $in: ["widget", "threads"] },
            ...(unreadMessageFilters.length > 0
              ? { $or: unreadMessageFilters }
              : { conversationId: { $in: [] } }),
          },
        },
        {
          $group: {
            _id: "$conversationId",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const latestMessagesMap = new Map<string, any>(
      latestMessages.map((item) => [item._id.toString(), item.message]),
    );

    const unreadCountsMap = new Map<string, number>(
      unreadCounts.map((item) => [item._id.toString(), item.count]),
    );

    const conversationsWithMeta = conversations.map((conv) => {
      const convIdStr = conv._id.toString();
      const lastMessage = latestMessagesMap.get(convIdStr) || null;
      const unreadCount = unreadCountsMap.get(convIdStr) || 0;
      return {
        ...conv,
        lastMessage,
        unreadCount,
        lastMessageAt: lastMessage?.createdAt || conv.updatedAt,
      };
    });

    return {
      conversations: conversationsWithMeta,
      total: conversations.length,
    };
  }

  /**
   * Get a specific conversation with all messages (validates org ownership)
   */
  async getConversationById(organizationId: string, conversationId: string) {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      organizationId,
    }).lean();
    if (!conversation) return null;

    const messages = await Message.find({ conversationId, organizationId })
      .sort({ createdAt: 1 })
      .lean();
    return { conversation, messages };
  }

  async markConversationRead(
    organizationId: string,
    conversationId: string,
    userId: string,
  ) {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, organizationId },
      {
        $set: {
          [`metadata.agentReads.${userId}.lastReadAt`]: new Date(),
        },
      },
      { returnDocument: "after", timestamps: false },
    ).lean();
  }

  async suggestReply(
    organizationId: string,
    conversationId: string,
    userId: string,
  ) {
    const result = await this.getConversationById(
      organizationId,
      conversationId,
    );
    if (!result) return null;

    const messages = (result.messages || []).slice(-10);
    const requestId = new Types.ObjectId().toString();

    await assistQueue.add("suggest-reply", {
      action: "suggest-reply",
      requestId,
      userId,
      organizationId,
      conversationId,
      payload: {
        messages: toAssistMessages(messages),
      },
    });

    return { requestId };
  }

  async generateNote(
    organizationId: string,
    conversationId: string,
    userId: string,
    fallbackContactName?: string,
  ) {
    const result = await this.getConversationById(
      organizationId,
      conversationId,
    );
    if (!result) return null;

    const contactName =
      result.conversation.metadata?.customer?.name ||
      result.conversation.metadata?.customerName ||
      result.conversation.metadata?.senderName ||
      fallbackContactName;

    const requestId = new Types.ObjectId().toString();

    await assistQueue.add("generate-note", {
      action: "generate-note",
      requestId,
      userId,
      organizationId,
      conversationId,
      payload: {
        contactName,
        messages: toAssistMessages(result.messages || []),
      },
    });

    return { requestId };
  }

  async assistDraft(
    organizationId: string,
    conversationId: string,
    userId: string,
    input: { draft?: string; mode?: "variations" | "reframe" },
  ) {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      organizationId,
    })
      .select("_id organizationId")
      .lean();
    if (!conversation) return null;

    const requestId = new Types.ObjectId().toString();

    await assistQueue.add("draft-assist", {
      action: "draft-assist",
      requestId,
      userId,
      organizationId,
      conversationId,
      payload: {
        draft: input.draft,
        mode: input.mode,
      },
    });

    return { requestId };
  }

  /**
   * Auto-assign conversation to a team/agent within the org.
   * Priority: online agents -> online admins -> null (no one online).
   */
  async autoAssignConversation(
    organizationId: string,
  ): Promise<{ agentId: string | null }> {
    try {
      const onlineStatuses = ["online"];
      const baseFilter = { organizationId, inviteStatus: "accepted" as const };

      const pickLeastBusy = async (
        memberships: any[],
      ): Promise<string | null> => {
        const online = memberships.filter(
          (m) =>
            (m.userId as any)?.isActive &&
            onlineStatuses.includes((m.userId as any)?.status),
        );
        if (online.length === 0) return null;
        const withLoad = await Promise.all(
          online.map(async (m) => {
            const userId = (m.userId as any)._id;
            const load = await Conversation.countDocuments({
              organizationId,
              assignedTo: userId,
              status: { $in: ["open", "pending"] },
            });
            return { agentId: userId.toString(), load };
          }),
        );
        withLoad.sort((a, b) => a.load - b.load);
        return withLoad[0].agentId;
      };

      // 1. Try agents first
      const agentMembers = await Membership.find({
        ...baseFilter,
        role: "agent",
      }).populate("userId", "name email status isActive");
      const agentId = await pickLeastBusy(agentMembers);
      if (agentId) return { agentId };

      // 2. No agents online — try admins
      const adminMembers = await Membership.find({
        ...baseFilter,
        role: "admin",
      }).populate("userId", "name email status isActive");
      const adminId = await pickLeastBusy(adminMembers);
      if (adminId) return { agentId: adminId };

      // 3. No admins online — try owners
      const ownerMembers = await Membership.find({
        ...baseFilter,
        role: "owner",
      }).populate("userId", "name email status isActive");
      const ownerId = await pickLeastBusy(ownerMembers);
      if (ownerId) return { agentId: ownerId };

      logger.warn(
        `[AutoAssign] No online members for org ${organizationId} — skipping assignment`,
      );
      return { agentId: null };
    } catch (error: any) {
      logger.error(`Error in auto-assignment: ${error.message}`);
      return { agentId: null };
    }
  }

  async routeConversation(
    organizationId: string,
    conversationId: string,
    data: RouteConversationInput,
    routedBy: string,
  ) {
    const { agentId, reason } = data;
    const conversation = await Conversation.findOne({
      _id: conversationId,
      organizationId,
    });
    if (!conversation) return { found: false };

    const agent = await User.findById(agentId).select("name email");

    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: conversationId, organizationId },
      {
        $set: {
          assignedTo: agentId,
          "metadata.routedBy": routedBy,
          "metadata.routedAt": new Date(),
          "metadata.routeReason": reason || "Manual routing",
          "metadata.escalatedAt": new Date(),
          "metadata.escalationReason": reason || "Manual routing",
          "metadata.pendingEscalation": false,
        },
        $addToSet: { participants: agentId },
      },
      { returnDocument: "after" },
    ).populate("assignedTo", "name email");

    // NOTE: Tickets and conversations are independent entities.
    // Routing a conversation does NOT reassign linked tickets.

    return {
      found: true,
      noAgent: false,
      agentNotFound: false,
      updatedConversation,
      selectedAgentId: agentId,
      agentName: agent?.name,
      agentEmail: (agent as any)?.email,
      originalConversation: conversation,
    };
  }


  async updateConversationStatus(
    organizationId: string,
    conversationId: string,
    status: string,
    updatedBy: string,
  ) {
    const validStatuses = ["open", "pending", "closed", "resolved"];
    if (!validStatuses.includes(status)) return { valid: false };

    const conversation = await Conversation.findOneAndUpdate(
      { _id: conversationId, organizationId },
      {
        $set: {
          status,
          "metadata.statusUpdatedBy": updatedBy,
          "metadata.statusUpdatedAt": new Date(),
        },
      },
      { returnDocument: "after" },
    );

    if (!conversation) return { valid: true, found: false };

    // NOTE: Tickets and conversations are independent entities.
    // Changing conversation status does NOT auto-resolve or close linked tickets.

    return { valid: true, found: true, conversation };
  }

  /**
   * Returns the minimal gate fields the AI service needs to check
   * whether it should still process a conversation (is it escalated / assigned?).
   * Used by the AI conversation.cache instead of a direct DB call.
   */
  async getConversationGate(organizationId: string, conversationId: string) {
    const conv = await Conversation.findOne(
      { _id: conversationId, organizationId },
      {
        status: 1,
        channel: 1,
        assignedTo: 1,
        "metadata.escalatedAt": 1,
        "metadata.humanJoinedAt": 1,
      },
    ).lean();

    if (!conv) return null;

    return {
      status: conv.status,
      ...(conv.channel === "threads" && { interactionSource: "threads" }),
      assignedTo: conv.assignedTo?.toString() || null,
      metadata: {
        escalatedAt: conv.metadata?.escalatedAt
          ? new Date(conv.metadata.escalatedAt).toISOString()
          : null,
        humanJoinedAt: conv.metadata?.humanJoinedAt
          ? new Date(conv.metadata.humanJoinedAt).toISOString()
          : null,
      },
    };
  }

  /**
   * Pushes a resolution entry to the conversation's metadata.resolvedQueries array.
   * Called by the AI mark_query_resolved tool via API instead of a direct DB write.
   */
  async markQueryResolved(
    organizationId: string,
    conversationId: string,
    resolutionEntry: Record<string, unknown>,
  ) {
    const resolvedAt = resolutionEntry.resolvedAt
      ? new Date(resolutionEntry.resolvedAt as string)
      : new Date();

    const result = await Conversation.updateOne(
      { _id: conversationId, organizationId },
      {
        $push: { "metadata.resolvedQueries": resolutionEntry },
        $set: {
          "metadata.lastResolvedAt": resolvedAt,
          "metadata.lastResolvedBy": "ai_tool",
        },
      },
    );

    return result.matchedCount > 0;
  }

  /**
   * Fetch recent conversation messages and visitor info for AI memory context.
   */
  async getConversationMemory(
    organizationId: string,
    conversationId: string,
    limit = 10,
  ) {
    const [messages, conversation] = await Promise.all([
      Message.find({ conversationId, organizationId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Conversation.findOne({ _id: conversationId, organizationId })
        .select("sessionId")
        .lean(),
    ]);

    const memory = messages.reverse().map((m) => ({
      messageId: m._id.toString(),
      role: ["widget", "threads", "telegram_channel", "whatsapp_channel", "email_channel"].includes(m.metadata?.source) ? "user" : "assistant",
      content: m.content,
      senderName: m.metadata?.senderName || null,
      timestamp: m.createdAt,
    }));

    let contact = null;
    if (conversation && (conversation as any).sessionId) {
      contact = await Contact.findOne({
        organizationId,
        sessionId: (conversation as any).sessionId,
      }).lean();
    }

    const visitorName =
      contact?.name && contact.name !== "Anonymous User" ? contact.name : null;
    const visitorEmail =
      contact?.email && contact.email !== "anonymous@temp.local"
        ? contact.email
        : null;

    return { memory, visitor: { name: visitorName, email: visitorEmail } };
  }

  /**
   * Save a record of an AI agent run / execution.
   */
  async createAgentRun(payload: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    steps: any[];
    duration: number;
    status: "success" | "failed";
    error?: string;
    usage?: any;
  }) {
    return SystemEvent.create({
      organizationId: payload.organizationId,
      category: "agent_execution",
      eventType: "agent_run",
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      latencyMs: payload.duration,
      success: payload.status === "success",
      error: payload.error,
      tokens: payload.usage
        ? {
            prompt: payload.usage.promptTokens,
            completion: payload.usage.completionTokens,
            total: payload.usage.totalTokens,
          }
        : undefined,
      metadata: {
        steps: payload.steps,
      },
    });
  }

  /**
   * Retrieve all agent run logs for a specific conversation.
   */
  async getAgentRuns(organizationId: string, conversationId: string) {
    const events = await SystemEvent.find({
      organizationId,
      conversationId,
      category: "agent_execution",
      eventType: "agent_run",
    })
      .sort({ createdAt: -1 })
      .lean();

    return events.map((e) => ({
      _id: e._id,
      organizationId: e.organizationId,
      conversationId: e.conversationId,
      messageId: e.messageId,
      steps: e.metadata?.steps || [],
      duration: e.latencyMs || 0,
      status: e.success ? "success" : "failed",
      error: e.error,
      usage: e.tokens
        ? {
            promptTokens: e.tokens.prompt,
            completionTokens: e.tokens.completion,
            totalTokens: e.tokens.total,
          }
        : undefined,
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
    }));
  }

  async closeInactiveConversations(
    inactivityLimitMs = 30 * 60 * 1000,
  ): Promise<{ closedCount: number }> {
    const cutoffTime = new Date(Date.now() - inactivityLimitMs);
    const inactiveConversations = await Conversation.find({
      channel: { $ne: "threads" },
      status: { $in: ["open", "pending"] },
      updatedAt: { $lt: cutoffTime },
    });

    let closedCount = 0;
    for (const conv of inactiveConversations) {
      await this.updateConversationStatus(
        conv.organizationId.toString(),
        conv._id.toString(),
        "closed",
        "system_inactivity_worker",
      );
      closedCount++;
    }

    return { closedCount };
  }

  async getPendingAnalysisConversations(): Promise<any[]> {
    const conversations = await Conversation.find({
      status: { $in: ["closed", "resolved"] },
      "metadata.analyzed": { $ne: true },
    })
      .limit(100)
      .lean();

    const results = [];
    for (const conv of conversations) {
      const messages = await Message.find({
        organizationId: conv.organizationId,
        conversationId: conv._id,
      })
        .sort({ createdAt: 1 })
        .lean();

      const contact = conv.sessionId
        ? await Contact.findOne({
            organizationId: conv.organizationId,
            sessionId: conv.sessionId,
          }).lean()
        : null;

      results.push({
        conversationId: conv._id.toString(),
        organizationId: conv.organizationId.toString(),
        visitor: contact
          ? {
              sessionId: contact.sessionId,
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              company: contact.company,
            }
          : { sessionId: conv.sessionId },
        messages: messages.map((m) => ({
          role: ["widget", "threads", "telegram_channel", "whatsapp_channel", "email_channel"].includes(m.metadata?.source) ? "user" : "assistant",
          content: m.content || "",
        })),
      });
    }

    return results;
  }

  /**
   * Get recently active/assigned conversations for an agent
   */
  async getRecentConversations(
    userId: string,
    organizationId: string,
  ): Promise<any[]> {
    try {
      // Fetch active conversations for this organization that:
      // - Are assigned to the user OR
      // - Are unassigned and visible in the inbox queue
      // Sorted by updatedAt desc, limited to 10
      const convs = await Conversation.find({
        organizationId,
        status: { $nin: ["closed", "resolved"] },
        $or: [
          { assignedTo: userId },
          {
            assignedTo: null,
            $or: INBOX_QUEUE_CONDITIONS,
          },
        ],
      })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      const results = [];
      for (const conv of convs) {
        // Get last message
        const lastMsg = await Message.findOne({
          conversationId: conv._id,
          organizationId,
        })
          .sort({ createdAt: -1 })
          .lean();

        // Get contact
        const contact = conv.sessionId
          ? await Contact.findOne({
              organizationId,
              sessionId: conv.sessionId,
            }).lean()
          : null;

        // Get linked ticket (if any) so sidebar can show Ticket badge and pass ticketId in URL
        const linkedTicket = await Ticket.findOne({
          organizationId,
          conversationId: conv._id,
        })
          .select("_id ticketNumber")
          .lean();

        results.push({
          _id: conv._id.toString(),
          subject: conv.subject || "No Subject",
          visitorName: contact?.name || "Anonymous User",
          channel: conv.channel || conv.metadata?.source || "widget",
          lastMessage: lastMsg?.content || "",
          openedAt: conv.updatedAt.getTime(),
          status: conv.status,
          ticketId: linkedTicket?._id?.toString() || undefined,
          ticketNumber: linkedTicket?.ticketNumber || undefined,
        });
      }
      return results;
    } catch (error: any) {
      logger.error(`Error in getRecentConversations: ${error.message}`);
      return [];
    }
  }
}
