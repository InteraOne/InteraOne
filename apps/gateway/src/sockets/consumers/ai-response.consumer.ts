import { redisClient } from "@shared/infra/redis";
import { Conversation, Message, User, Membership } from "@shared/models";
import { ChannelService } from "@modules/channels/channels.service";
import { incrementMessageUsage } from "@shared/security/middleware";
import { resolveUsagePeriodAndReset } from "@shared/security/middleware/rate-limit";
import { resolveOrganizationPlan } from "@shared/ee";
import {
  enqueueUsageThresholdWarningEmail,
  enqueueUsageExhaustedEmail,
} from "@shared/queues/email.queue";
import { tracker } from "@shared/utils/tracker";
import logger from "@shared/core/logger";
import { socketService } from "../services/socket.service";

const PUBSUB_CHANNEL = "ai:response";

// ── Consumer startup ───────────────────────────────────────────────────────────

export async function startAIResponseConsumer(): Promise<void> {
  const subscriber = redisClient.duplicate();
  await subscriber.connect();

  // ── AI response channel ──────────────────────────────────────────────────────
  await subscriber.subscribe(PUBSUB_CHANNEL, async (message) => {
    try {
      const { conversationId, messageId, content, usage, nonce } = JSON.parse(
        message,
      ) as {
        conversationId: string;
        messageId?: string;
        content: string;
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
          estimatedCostUsd?: number;
        };
        nonce?: string;
      };

      if (nonce) {
        const claimed = await redisClient.set(`dedup:${nonce}`, "1", {
          NX: true,
          EX: 30,
        });
        if (!claimed) return;
      }

      // Resolve org and channel details from conversation record
      const conv = await Conversation.findById(conversationId)
        .select(
          "organizationId status channel channelId metadata assignedTo sessionId subject",
        )
        .lean();

      if (!conv) return;

      if (
        (conv as any).metadata?.escalatedAt ||
        (conv as any).metadata?.humanJoinedAt ||
        (conv as any).assignedTo ||
        ["resolved", "closed"].includes((conv as any).status)
      ) {
        logger.info(
          `[AI Response] Skipping ${conversationId} because conversation is escalated or closed`,
        );
        return;
      }

      const organizationId = conv?.organizationId?.toString() || "";

      // ── Message usage tracking ──────────────────────────────────────────────
      const usageResult = await incrementMessageUsage(organizationId);

      handleUsageThresholdEmails(
        organizationId,
        usageResult.used,
        usageResult.limit,
        usageResult.blocked,
      ).catch((err) =>
        logger.error("[AI Response] Error handling threshold emails:", err),
      );

      if (usageResult.blocked) {
        logger.warn(
          `[AI Response] Message limit reached for org=${organizationId} (used=${usageResult.used} limit=${usageResult.limit}) — dropping AI response`,
        );
        socketService.emitToConversation(conversationId, "limit_reached", {
          limitType: "messages",
          currentUsage: usageResult.used,
          limit: usageResult.limit,
          upgradeRequired: true,
        });
        return;
      }

      const msg = new Message({
        conversationId,
        organizationId,
        senderId: "ai-bot",
        content,
        type: "text",
        metadata: {
          senderName: "AI Assistant",
          senderEmail: "ai@interaone.internal",
          source: "ai",
        },
      });
      await msg.save();

      // Forward AI response to external channels if applicable
      ChannelService.sendConversationReply(
        organizationId,
        conversationId,
        content,
      ).catch((err: any) => {
        logger.error(
          `[AI Response Consumer] Failed to forward AI response to channel:`,
          err,
        );
      });
      tracker.trackMessage(
        organizationId,
        "ai",
        { messageLength: content.length },
        { conversationId, channel: "widget" },
      );

      tracker.trackEvent(
        organizationId,
        "ai_response",
        "ai",
        { messageLength: content.length },
        { conversationId, channel: "widget" },
      );

      const hasTokenUsage = Boolean(
        usage &&
        ((usage.totalTokens && usage.totalTokens > 0) ||
          (usage.promptTokens && usage.promptTokens > 0) ||
          (usage.completionTokens && usage.completionTokens > 0)),
      );

      if (hasTokenUsage) {
        tracker.trackEvent(
          organizationId,
          "ai_token_usage",
          "ai",
          {
            promptTokens: usage?.promptTokens || 0,
            completionTokens: usage?.completionTokens || 0,
            totalTokens: usage?.totalTokens || 0,
            estimatedCostUsd: usage?.estimatedCostUsd || 0,
          },
          { conversationId, channel: "widget" },
        );
      }

      socketService.emitToConversation(conversationId, "new_message", {
        conversationId,
        streamMessageId: messageId,
        message: {
          _id: msg._id,
          senderId: msg.senderId,
          content: msg.content,
          type: msg.type,
          metadata: msg.metadata,
          createdAt: msg.createdAt,
        },
      });

      logger.info(`AI response delivered to conversation ${conversationId}`);
    } catch (err) {
      logger.error("Failed to handle AI response:", err);
    }
  });

  // ── AI stream channel ──────────────────────────────────────────────────────
  await subscriber.subscribe("ai:stream", async (raw) => {
    try {
      const { conversationId, chunk, isThought, seq, messageId, toolEvent } =
        JSON.parse(raw) as {
          conversationId: string;
          chunk: string;
          isThought: boolean;
          seq?: number;
          messageId?: string;
          toolEvent?: {
            type: "start" | "complete";
            toolName: string;
            label: string;
            detail?: string;
            status?: "succeeded" | "failed";
          };
        };

      // Do not forward stream chunks once a human has taken over
      const conv = await Conversation.findById(conversationId)
        .select("status metadata assignedTo")
        .lean();
      if (
        (conv as any)?.metadata?.escalatedAt ||
        (conv as any)?.metadata?.humanJoinedAt ||
        (conv as any)?.assignedTo ||
        ["resolved", "closed"].includes((conv as any)?.status)
      ) {
        return;
      }

      // Emit chunk directly to active clients without DB persistence
      socketService.emitToConversation(conversationId, "ai_stream_chunk", {
        conversationId,
        chunk,
        isThought,
        seq,
        messageId,
        toolEvent,
      });
    } catch (err) {
      logger.error("Failed to handle AI stream chunk:", err);
    }
  });

  logger.info("AI response subscriber ready");
}

async function handleUsageThresholdEmails(
  organizationId: string,
  used: number,
  limit: number | null,
  blocked: boolean,
): Promise<void> {
  if (limit === null) return;

  const pct = Math.round((used / limit) * 100);
  const is90 = pct >= 90 && pct < 100;
  const is100 = pct >= 100 || blocked;

  if (!is90 && !is100) return;

  try {
    const plan = await resolveOrganizationPlan(organizationId);
    const { period, resetAt } = await resolveUsagePeriodAndReset(
      organizationId,
      plan,
    );

    const type = is100 ? "100pct" : "90pct";
    const cacheKey = `usage:warned:${type}:${organizationId}:${period}`;

    const alreadyWarned = await redisClient.get(cacheKey);
    if (alreadyWarned) return;

    const ownerMembership = await Membership.findOne({
      organizationId,
      role: "owner",
      inviteStatus: "accepted",
    }).lean();

    if (!ownerMembership) return;

    const ownerUser = await User.findById(ownerMembership.userId).lean();
    if (!ownerUser || !ownerUser.email) return;

    const resetDateStr = resetAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    if (is100) {
      const queued = await enqueueUsageExhaustedEmail(
        ownerUser.email,
        ownerUser.name,
        used,
        limit,
        resetDateStr,
      );
      if (queued) {
        await redisClient.set(cacheKey, "1", { EX: 35 * 24 * 60 * 60 });
      }
    } else if (is90) {
      const queued = await enqueueUsageThresholdWarningEmail(
        ownerUser.email,
        ownerUser.name,
        pct,
        used,
        limit,
        resetDateStr,
      );
      if (queued) {
        await redisClient.set(cacheKey, "1", { EX: 35 * 24 * 60 * 60 });
      }
    }
  } catch (err) {
    logger.error(
      "[handleUsageThresholdEmails] Failed to send usage threshold email:",
      err,
    );
  }
}
