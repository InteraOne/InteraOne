import { Channel, IChannel, ChannelType } from "@shared/models/Channel";
import { Conversation, Message, Organization, Ticket, Contact, User, Membership } from "@shared/models";
import { aiQueue } from "@shared/infra/queue";
import { isQuotaExhausted } from "../../shared/security/middleware/rate-limit";
import { socketService } from "@sockets/services/socket.service";
import { ChannelStrategyFactory } from "./core/ChannelStrategyFactory";
import { SendMessageInput } from "./core/IChannelStrategy";
import logger from "@shared/core/logger";
import config from "@shared/infra/config";
import { enqueueChannelVerifiedEmail } from "@shared/queues/email.queue";
import { buildTicketLifecycleEmail } from "@shared/utils/email";
import { createHash } from "node:crypto";
import {
  CreateEmailChannelInput,
  CreateWhatsAppChannelInput,
  CreateTelegramChannelInput,
} from "./channels.types";

export interface TicketFollowupResult {
  success: boolean;
  duplicate?: boolean;
  messageId?: string;
  providerMessageId?: string;
  error?: string;
  errorCode?:
    | "TICKET_NOT_FOUND"
    | "IDEMPOTENCY_CONFLICT"
    | "REQUEST_IN_PROGRESS"
    | "INVALID_RECIPIENT"
    | "EMAIL_CHANNEL_NOT_FOUND"
    | "EMAIL_SEND_FAILED"
    | "DATABASE_ERROR";
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * ChannelService is the "context" in the Strategy pattern.
 * It delegates all provider-specific logic to the strategy returned by
 * ChannelStrategyFactory, keeping this class channel-type agnostic.
 */
export class ChannelService {
  // ─── Create ─────────────────────────────────────────────────────────────────

  /**
   * Create an email channel for an organization.
   * One channel per org per type — enforced by model index + explicit check.
   */
  static async createEmailChannel(
    organizationId: string,
    input: CreateEmailChannelInput,
  ): Promise<IChannel> {
    // One channel per org per type
    const existing = await Channel.findOne({ organizationId, type: "email" });
    if (existing) {
      throw new Error(
        "An email channel already exists for this organization. Delete it first to create a new one.",
      );
    }

    const initialEmail = input.email?.trim().toLowerCase();

    // Build the initial domain config. Addresses are created only after the
    // provider confirms that this domain belongs to the organization.
    const channel = await Channel.create({
      organizationId,
      type: "email" as ChannelType,
      name: input.name,
      isActive: true,
      config: {
        email: {
          ...(initialEmail ? { address: initialEmail } : {}),
          addresses: initialEmail ? [initialEmail] : [],
          domain: input.domain.trim().toLowerCase(),
          verificationStatus: "pending",
          dnsRecords: [],
        },
      },
    });

    // Provision with SES — adds domain and fetches DNS records
    const strategy = ChannelStrategyFactory.create("email");
    const provisionResult = await strategy.provision(channel._id.toString(), channel.config);

    if (!provisionResult.success) {
      // Clean up the orphaned channel doc
      await Channel.findByIdAndDelete(channel._id);
      throw new Error(provisionResult.error || "Failed to provision email channel");
    }

    // Persist the updated config (domainId + dnsRecords)
    channel.config = provisionResult.updatedConfig;
    await channel.save();

    logger.info("[ChannelService] Email channel created and provisioned", {
      channelId: channel._id.toString(),
      organizationId,
      domain: input.domain,
    });

    return channel;
  }

  /**
   * Create a WhatsApp channel for an organization.
   * One channel per org per type — enforced by model index + explicit check.
   */
  static async createWhatsAppChannel(
    organizationId: string,
    input: CreateWhatsAppChannelInput,
  ): Promise<IChannel> {
    // One channel per org per type
    const existing = await Channel.findOne({ organizationId, type: "whatsapp" });
    if (existing) {
      throw new Error(
        "A WhatsApp channel already exists for this organization. Delete it first to create a new one.",
      );
    }

    // Build the initial channel config (pre-provision)
    const channel = await Channel.create({
      organizationId,
      type: "whatsapp" as ChannelType,
      name: input.name,
      isActive: true,
      config: {
        whatsapp: {
          phoneNumber: input.phoneNumber.trim(),
          accountSid: input.accountSid.trim(),
          authToken: input.authToken.trim(),
          messagingServiceSid: input.messagingServiceSid?.trim() || undefined,
          verificationStatus: "pending",
        },
      },
    });

    // Provision with WhatsApp strategy — validates Twilio credentials
    const strategy = ChannelStrategyFactory.create("whatsapp");
    const provisionResult = await strategy.provision(channel._id.toString(), channel.config);

    if (!provisionResult.success) {
      // Clean up the orphaned channel doc
      await Channel.findByIdAndDelete(channel._id);
      throw new Error(provisionResult.error || "Failed to provision WhatsApp channel");
    }

    // Persist the updated config (marked as verified)
    channel.config = provisionResult.updatedConfig;
    await channel.save();

    this.notifyChannelVerification(organizationId, "WhatsApp", input.phoneNumber).catch((err) => {
      logger.error(`[createWhatsAppChannel] Failed to send verification email: ${err.message}`);
    });

    logger.info("[ChannelService] WhatsApp channel created and provisioned", {
      channelId: channel._id.toString(),
      organizationId,
      phoneNumber: input.phoneNumber,
    });

    return channel;
  }

  /**
   * Create a Telegram channel for an organization.
   * One channel per org per type — enforced by model index + explicit check.
   */
  static async createTelegramChannel(
    organizationId: string,
    input: CreateTelegramChannelInput,
  ): Promise<IChannel> {
    // One channel per org per type
    const existing = await Channel.findOne({ organizationId, type: "telegram" });
    if (existing) {
      throw new Error(
        "A Telegram channel already exists for this organization. Delete it first to create a new one.",
      );
    }

    // Build the initial channel config (pre-provision)
    const channel = await Channel.create({
      organizationId,
      type: "telegram" as ChannelType,
      name: input.name,
      isActive: true,
      config: {
        telegram: {
          botToken: input.botToken.trim(),
          verificationStatus: "pending",
        },
      },
    });

    // Provision with Telegram strategy — validates token and sets up webhook
    const strategy = ChannelStrategyFactory.create("telegram");
    const provisionResult = await strategy.provision(channel._id.toString(), channel.config);

    if (!provisionResult.success) {
      // Clean up the orphaned channel doc
      await Channel.findByIdAndDelete(channel._id);
      throw new Error(provisionResult.error || "Failed to provision Telegram channel");
    }

    // Persist the updated config (marked as verified + username)
    channel.config = provisionResult.updatedConfig;
    await channel.save();

    this.notifyChannelVerification(organizationId, "Telegram", channel.config.telegram?.botUsername || input.name).catch((err) => {
      logger.error(`[createTelegramChannel] Failed to send verification email: ${err.message}`);
    });

    logger.info("[ChannelService] Telegram channel created and provisioned", {
      channelId: channel._id.toString(),
      organizationId,
      botUsername: channel.config.telegram?.botUsername,
    });

    return channel;
  }



  // ─── Read ────────────────────────────────────────────────────────────────────

  static async getChannel(organizationId: string): Promise<IChannel | null> {
    return Channel.findOne({ organizationId, type: "email" }).lean() as unknown as Promise<IChannel | null>;
  }

  static async getWhatsAppChannel(organizationId: string): Promise<IChannel | null> {
    return Channel.findOne({ organizationId, type: "whatsapp" }).lean() as unknown as Promise<IChannel | null>;
  }

  static async getTelegramChannel(organizationId: string): Promise<IChannel | null> {
    return Channel.findOne({ organizationId, type: "telegram" }).lean() as unknown as Promise<IChannel | null>;
  }



  static async getAllChannels(organizationId: string): Promise<IChannel[]> {
    return Channel.find({ organizationId }).lean() as unknown as Promise<IChannel[]>;
  }

  // ─── Verify ──────────────────────────────────────────────────────────────────

  /**
   * Trigger SES domain verification and update the channel's DNS records +
   * verification status in the database.
   */
  static async verifyChannel(
    organizationId: string,
    channelId: string,
  ): Promise<{ status: string; dnsRecords: unknown }> {
    const channel = await Channel.findOne({ _id: channelId, organizationId });
    if (!channel) {
      throw new Error("Channel not found");
    }

    const previousStatus = channel.config.email?.verificationStatus;

    const strategy = ChannelStrategyFactory.create(channel.type);
    const result = await strategy.checkVerification(channelId, channel.config);

    if (result.updatedConfig) {
      // Merge updated fields back (deep merge email config)
      if (result.updatedConfig.email) {
        channel.config.email = {
          ...channel.config.email!,
          ...result.updatedConfig.email,
        };
      }
      channel.markModified("config");
      await channel.save();
    }

    const currentStatus = channel.config.email?.verificationStatus;
    if (currentStatus === "verified" && previousStatus !== "verified") {
      this.notifyChannelVerification(organizationId, "Email", channel.config.email?.domain || channel.name).catch((err) => {
        logger.error(`[verifyChannel] Failed to send verification email: ${err.message}`);
      });
    }

    return {
      status: result.status,
      dnsRecords: channel.config.email?.dnsRecords ?? [],
    };
  }

  private static async notifyChannelVerification(organizationId: string, channelType: string, channelName: string) {
    try {
      const ownerMembership = await Membership.findOne({
        organizationId,
        role: "owner",
        inviteStatus: "accepted",
      }).lean();

      if (ownerMembership) {
        const ownerUser = await User.findById(ownerMembership.userId).lean();
        if (ownerUser && ownerUser.email) {
          await enqueueChannelVerifiedEmail(ownerUser.email, ownerUser.name, channelType, channelName);
        }
      }
    } catch (err: any) {
      logger.error(`[ChannelService] Failed to send channel verification email: ${err.message}`);
    }
  }


  // ─── Send ────────────────────────────────────────────────────────────────────

  static async sendViaChannel(
    organizationId: string,
    channelId: string,
    input: Omit<SendMessageInput, "channelConfig">,
  ): Promise<{ messageId?: string }> {
    const channel = await Channel.findOne({ _id: channelId, organizationId });
    if (!channel) {
      throw new Error("Channel not found");
    }

    const strategy = ChannelStrategyFactory.create(channel.type);
    const result = await strategy.send({ ...input, channelConfig: channel.config });

    if (!result.success) {
      throw new Error(result.error || "Failed to send message via channel");
    }

    return { messageId: result.messageId };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  static async deleteChannel(
    organizationId: string,
    channelId: string,
  ): Promise<void> {
    const channel = await Channel.findOne({ _id: channelId, organizationId });
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Deprovision from provider first
    const strategy = ChannelStrategyFactory.create(channel.type);
    await strategy.deprovision(channelId, channel.config);

    await Channel.findByIdAndDelete(channelId);

    logger.info("[ChannelService] Channel deleted", {
      channelId,
      organizationId,
      type: channel.type,
    });
  }

  static async updateEmailChannelAddresses(
    organizationId: string,
    channelId: string,
    emails: string[],
  ): Promise<IChannel> {
    const channel = await Channel.findOne({ _id: channelId, organizationId });
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (channel.type !== "email") {
      throw new Error("Channel is not an email channel");
    }
    if (!channel.config.email) {
      throw new Error("Email configuration is missing");
    }

    if (channel.config.email.verificationStatus !== "verified") {
      throw new Error("Verify the domain before creating email addresses");
    }

    const domain = channel.config.email.domain;
    const cleanEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

    for (const email of cleanEmails) {
      if (!email.endsWith(`@${domain}`)) {
        throw new Error(`Email "${email}" must belong to the verified domain "${domain}"`);
      }
    }

    channel.config.email.addresses = cleanEmails;
    // The first email in the list is always treated as the primary address
    channel.config.email.address = cleanEmails[0];

    channel.markModified("config");
    await channel.save();
    return channel;
  }

  // ─── Inbound ─────────────────────────────────────────────────────────────────

  static async handleInbound(
    channelId: string,
    payload: unknown,
  ): Promise<{ conversationId?: string; messageId?: string }> {
    const channel = await Channel.findById(channelId);
    if (!channel || !channel.isActive) {
      throw new Error("Channel not found or inactive");
    }

    const strategy = ChannelStrategyFactory.create(channel.type);
    const result = await strategy.handleInbound({ raw: payload, channelId });

    if (!result.success) {
      throw new Error(result.error || "Failed to process inbound message");
    }

    // Enqueue message to aiQueue for AI processing if conversation is not assigned to a human
    if (result.conversationId && result.messageId) {
      try {
        const message = await Message.findById(result.messageId);
        if (message) {
          const conversation = await Conversation.findById(result.conversationId);
          const isHumanHandled =
            conversation &&
            (conversation.assignedTo ||
              (conversation.metadata as any)?.escalatedAt ||
              (conversation.metadata as any)?.humanJoinedAt);

          if (isHumanHandled) {
            // Only emit to conversation room when a human agent is actively handling it
            socketService.emitToConversation(result.conversationId, "new_message", {
              conversationId: result.conversationId,
              message: {
                _id: message._id,
                senderId: message.senderId,
                content: message.content,
                type: message.type,
                metadata: message.metadata,
                createdAt: message.createdAt,
              },
            });
          } else if (
            conversation &&
            !["resolved", "closed"].includes(conversation.status) &&
            message.content
          ) {
            // Unassigned and unescalated — let the AI handle it
            const org = await Organization.findById(channel.organizationId).select("subscriptionStatus").lean();
            let subscriptionExpired = org ? (org.subscriptionStatus !== null && org.subscriptionStatus !== undefined && org.subscriptionStatus !== "active") : false;
            
            if (!subscriptionExpired) {
              const isExhausted = await isQuotaExhausted(channel.organizationId.toString());
              if (isExhausted) {
                subscriptionExpired = true;
              }
            }

            await aiQueue.add("process", {
              organizationId: channel.organizationId.toString(),
              conversationId: result.conversationId,
              content: message.content,
              messageId: result.messageId,
              channel: channel.type,
              aiEnabled: true,
              subscriptionExpired,
            });
            logger.info("[ChannelService] Inbound message enqueued for AI processing", {
              conversationId: result.conversationId,
              messageId: result.messageId,
              channel: channel.type,
            });
          }
        }
      } catch (err: any) {
        logger.error("[ChannelService] Failed to process inbound message pipeline", {
          conversationId: result.conversationId,
          messageId: result.messageId,
          error: err.message,
        });
      }
    }

    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }

  // ─── Outbound ─────────────────────────────────────────────────────────────────

  /**
   * Send a reply back to the customer on the conversation's native channel
   * (Telegram → Telegram, WhatsApp → WhatsApp, Email → Email).
   * Used by: agent WebSocket handler and AI response consumer.
   * Widget conversations are silently skipped (no channelId stored).
   */
  static async sendConversationReply(
    organizationId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      logger.error(`[ChannelService] Conversation ${conversationId} not found`);
      return;
    }

    let channelType = conversation.channel || conversation.metadata?.channel;
    let channelId = conversation.channelId || conversation.metadata?.channelId;

    if (!channelType || !channelId) {
      return; // Not an external channel conversation
    }

    let to: string | undefined;
    const convMeta = (conversation.metadata as any) || {};

    if (channelType === "email_channel") {
      if (conversation.sessionId?.startsWith("email-")) {
        to = conversation.sessionId.replace("email-", "");
      }
      if (!to && convMeta.senderEmail) {
        to = convMeta.senderEmail;
      }
      if (!to && conversation.sessionId) {
        const contact = await Contact.findOne({ sessionId: conversation.sessionId, organizationId }).lean();
        if (contact?.email) {
          to = contact.email;
        }
      }
    } else if (channelType === "whatsapp_channel") {
      if (conversation.sessionId?.startsWith("whatsapp-")) {
        to = conversation.sessionId.replace("whatsapp-", "");
      }
      if (!to && convMeta.phone) {
        to = convMeta.phone;
      }
      if (!to && conversation.sessionId) {
        const contact = await Contact.findOne({ sessionId: conversation.sessionId, organizationId }).lean();
        if (contact?.phone) {
          to = contact.phone;
        }
      }
    } else if (channelType === "telegram_channel") {
      if (conversation.sessionId?.startsWith("telegram-")) {
        to = conversation.sessionId.replace("telegram-", "");
      }
      if (!to && convMeta.chatId) {
        to = convMeta.chatId;
      }
    }

    if (to) {
      await this.sendViaChannel(organizationId, channelId.toString(), {
        to,
        subject: conversation.subject || "Reply from Support",
        body: content,
        from: convMeta.supportEmail,
        inReplyTo: convMeta.lastInboundMessageId,
        references: convMeta.lastInboundMessageId,
      });
    }
  }

  /**
   * Send a follow-up email to the customer on behalf of a ticket.
   * Always routes via email regardless of the ticket's original source.
   * Used by: POST /tickets/:ticketId/reply (agent UI).
   */
  static async sendTicketFollowup(
    organizationId: string,
    ticketId: string,
    content: string,
    agentUser?: { userId: string; name: string; email: string },
    idempotencyKey?: string,
  ): Promise<TicketFollowupResult> {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) {
      return {
        success: false,
        errorCode: "IDEMPOTENCY_CONFLICT",
        error: "An idempotency key is required",
      };
    }

    const keyHash = createHash("sha256").update(normalizedKey).digest("hex");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const followupPath = `metadata.ticketFollowups.${keyHash}`;
    let emailSent = false;

    const releaseReservation = async (): Promise<void> => {
      try {
        await Ticket.updateOne(
          { _id: ticketId, organizationId },
          { $unset: { [followupPath]: "" } },
        );
      } catch (err: any) {
        logger.error("[ChannelService.sendTicketFollowup] Failed to release idempotency reservation", {
          ticketId,
          error: err.message,
        });
      }
    };

    try {
      // Atomically reserve this request before any provider call so concurrent
      // retries cannot send the same email twice.
      const ticket = await Ticket.findOneAndUpdate(
        {
          _id: ticketId,
          organizationId,
          [followupPath]: { $exists: false },
        },
        {
          $set: {
            [followupPath]: {
              status: "processing",
              contentHash,
              createdAt: new Date(),
            },
          },
        },
        { new: true },
      );

      if (!ticket) {
        const existingTicket = await Ticket.findOne({ _id: ticketId, organizationId }).lean();
        if (!existingTicket) {
          return {
            success: false,
            errorCode: "TICKET_NOT_FOUND",
            error: "Ticket not found",
          };
        }

        const existingFollowup = (existingTicket.metadata as any)?.ticketFollowups?.[keyHash];
        if (existingFollowup?.contentHash !== contentHash) {
          return {
            success: false,
            errorCode: "IDEMPOTENCY_CONFLICT",
            error: "The idempotency key was already used with different content",
          };
        }
        if (existingFollowup?.status === "completed") {
          return {
            success: true,
            duplicate: true,
            messageId: existingFollowup.messageId,
            providerMessageId: existingFollowup.providerMessageId,
          };
        }
        return {
          success: false,
          duplicate: true,
          errorCode: "REQUEST_IN_PROGRESS",
          error: "A reply with this idempotency key is already being processed",
        };
      }

      const metadata = (ticket.metadata || {}) as Record<string, unknown>;
      let recipientName =
        typeof metadata.requesterName === "string" && metadata.requesterName.trim()
          ? metadata.requesterName.trim()
          : "there";

      // Resolve recipient email — prefer contact record, then ticket metadata, then linked conversation metadata
      let to: string | undefined;
      let linkedConversation: any = null;
      if (ticket.contactId) {
        const contact = await Contact.findOne({
          _id: ticket.contactId,
          organizationId,
        })
          .select("name email")
          .lean();
        to = contact?.email?.trim().toLowerCase() || undefined;
        if (contact?.name) {
          recipientName = contact.name;
        }
      }

      if (!to && typeof metadata.requesterEmail === "string") {
        to = metadata.requesterEmail.trim().toLowerCase();
      }

      if (ticket.conversationId) {
        linkedConversation = await Conversation.findOne({
          _id: ticket.conversationId,
          organizationId,
        })
          .select("sessionId metadata.senderName metadata.senderEmail")
          .lean();

        if (!linkedConversation) {
          throw new Error("Linked conversation not found");
        }
        if (!to && typeof linkedConversation.metadata?.senderEmail === "string") {
          to = linkedConversation.metadata.senderEmail.trim().toLowerCase();
        }
        if (
          recipientName === "there" &&
          typeof linkedConversation.metadata?.senderName === "string" &&
          linkedConversation.metadata.senderName.trim()
        ) {
          recipientName = linkedConversation.metadata.senderName.trim();
        }

        if (!to && linkedConversation.sessionId) {
          const contact = await Contact.findOne({
            organizationId,
            sessionId: linkedConversation.sessionId,
          })
            .select("name email")
            .lean();
          to = contact?.email?.trim().toLowerCase() || undefined;
          if (recipientName === "there" && contact?.name) {
            recipientName = contact.name;
          }
        }
      }

      const validEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!to || to === "anonymous@temp.local" || !validEmailPattern.test(to)) {
        await releaseReservation();
        logger.error(`[ChannelService.sendTicketFollowup] Invalid recipient email for ticket ${ticketId}`);
        return {
          success: false,
          errorCode: "INVALID_RECIPIENT",
          error: "A valid recipient email address is required",
        };
      }

      // Find the org's active email channel
      let emailChannel = await Channel.findOne({
        organizationId,
        type: "email",
        isActive: true,
      }).lean();

      // Dev fallback: auto-create a mailhog channel if none exists
      if (!emailChannel && config.email.provider === "mailhog") {
        emailChannel = (await Channel.create({
          organizationId,
          type: "email",
          name: "Local Dev Email Channel",
          isActive: true,
          config: {
            email: {
              address: "support@localhost.local",
              addresses: ["support@localhost.local"],
              domain: "localhost.local",
              verificationStatus: "verified",
              dnsRecords: [],
            },
          },
        })) as any;
      }

      if (!emailChannel) {
        await releaseReservation();
        logger.error(`[ChannelService.sendTicketFollowup] No active email channel for org ${organizationId}`);
        return {
          success: false,
          errorCode: "EMAIL_CHANNEL_NOT_FOUND",
          error: "No active email channel is configured",
        };
      }

      // Render the ticket lifecycle HTML email template
      let emailHtml: string | undefined;
      let emailSubject: string | undefined;
      try {
        const emailObj = await buildTicketLifecycleEmail("updated", {
          name: recipientName,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          status: String(ticket.status).replace(/_/g, " "),
          priority: ticket.priority,
          updateSummary: content,
        });
        emailHtml = emailObj.html;
        emailSubject = emailObj.subject;
      } catch (err: any) {
        logger.error("[ChannelService.sendTicketFollowup] Failed to build email template:", err.message);
      }

      let sendResult: { messageId?: string };
      try {
        sendResult = await this.sendViaChannel(organizationId, emailChannel._id.toString(), {
          to,
          subject: emailSubject || `Re: ${ticket.title}`,
          body: content,
          html: emailHtml,
        });
        emailSent = true;
      } catch (err: any) {
        await releaseReservation();
        logger.error("[ChannelService.sendTicketFollowup] Failed to send ticket reply", {
          ticketId,
          to,
          error: err.message,
        });
        return {
          success: false,
          errorCode: "EMAIL_SEND_FAILED",
          error: err.message || "Failed to send ticket reply",
        };
      }

      logger.info("[ChannelService.sendTicketFollowup] Ticket reply sent via email", {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        to,
      });

      let msg: InstanceType<typeof Message> | undefined;
      if (ticket.conversationId) {
        msg = await Message.create({
          organizationId,
          conversationId: ticket.conversationId,
          senderId: agentUser?.userId || "system",
          content,
          type: "text",
          metadata: {
            source: "web",
            senderName: agentUser?.name || "Agent",
            senderEmail: agentUser?.email || "",
            ticketId,
            ticketFollowupIdempotencyKey: keyHash,
            providerMessageId: sendResult.messageId,
          },
        });

        const conversationUpdate: Record<string, any> = {
          $set: { status: "open" },
          $currentDate: { updatedAt: true },
        };
        if (agentUser?.userId) {
          conversationUpdate.$set.assignedTo = agentUser.userId;
          conversationUpdate.$addToSet = { participants: agentUser.userId };
        }

        const updateResult = await Conversation.updateOne(
          { _id: ticket.conversationId, organizationId },
          conversationUpdate,
        );
        if (updateResult.matchedCount === 0) {
          throw new Error("Linked conversation not found while saving reply");
        }
      }

      const completionResult = await Ticket.updateOne(
        { _id: ticketId, organizationId, [`${followupPath}.status`]: "processing" },
        {
          $set: {
            [`${followupPath}.status`]: "completed",
            [`${followupPath}.completedAt`]: new Date(),
            [`${followupPath}.messageId`]: msg?._id.toString(),
            [`${followupPath}.providerMessageId`]: sendResult.messageId,
          },
        },
      );
      if (completionResult.modifiedCount !== 1) {
        throw new Error("Failed to complete the idempotent ticket reply record");
      }

      // Emit only after the message and conversation updates are persisted.
      if (ticket.conversationId && msg) {
        try {
          socketService.emitToConversation(ticket.conversationId.toString(), "new_message", {
            conversationId: ticket.conversationId.toString(),
            message: {
              _id: msg._id,
              senderId: msg.senderId,
              content: msg.content,
              type: msg.type,
              metadata: msg.metadata,
              createdAt: msg.createdAt,
            },
          });

          socketService.emitToOrg(organizationId, "status_updated", {
            conversationId: ticket.conversationId.toString(),
            status: "open",
          });
          if (agentUser?.userId) {
            socketService.emitToOrg(organizationId, "conversation_assigned", {
              conversationId: ticket.conversationId.toString(),
              agentId: agentUser.userId,
              agentName: agentUser.name,
            });
          }
        } catch (err: any) {
          logger.error("[ChannelService.sendTicketFollowup] Failed to emit conversation updates", {
            ticketId,
            conversationId: ticket.conversationId.toString(),
            error: err.message,
          });
        }
      }

      return {
        success: true,
        messageId: msg?._id.toString(),
        providerMessageId: sendResult.messageId,
      };
    } catch (err: any) {
      if (!emailSent) {
        await releaseReservation();
      }
      logger.error("[ChannelService.sendTicketFollowup] Failed to persist ticket reply", {
        ticketId,
        emailSent,
        error: err.message,
      });
      return {
        success: false,
        errorCode: "DATABASE_ERROR",
        error: emailSent
          ? "The email was sent, but the reply could not be fully persisted"
          : err.message || "Failed to process ticket reply",
      };
    }
  }
}
