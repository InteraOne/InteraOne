import { Message, Conversation } from "@shared/models";
import logger from "@shared/core/logger";
import { socketService } from "@sockets/services/socket.service";
import { tracker } from "@shared/utils/tracker";
import { ChannelService } from "@modules/channels";

export const handleAgentMessage = ({ socket, io }: { socket: any; io: any }) => {
  socket.on(
    "send_message",
    async (data: {
      conversationId: string;
      content: string;
      type: string;
      metadata?: {
        senderName?: string;
        senderEmail?: string;
      };
    }) => {
      const { conversationId, content, type, metadata } = data;

      try {
        const gateState = socket.data.gateState;
        if (!gateState) {
          logger.error(`Conversation gate state missing for agent message on conversation ${conversationId}`);
          return;
        }

        const orgId = socket.data.user.orgId;

        const message = new Message({
          organizationId: orgId,
          conversationId,
          senderId: socket.data.user.userId,
          content,
          type,
          metadata: {
            source: "web",
            senderName: metadata?.senderName || socket.data.user.name || "Agent",
            senderEmail: metadata?.senderEmail || socket.data.user.email || "",
          },
        });
        await message.save();

        const agentId = socket.data.user.userId;
        const startedAt = gateState.customerStartedAt;

        tracker.trackMessage(
          orgId.toString(),
          "agent",
          { messageLength: content.length },
          { conversationId, agentId, channel: "web" },
        );

        // Update conversation's last activity, assignment & escalation status
        await Conversation.updateOne(
          { _id: conversationId, organizationId: orgId },
          {
            $set: {
              assignedTo: agentId,
              "metadata.humanJoinedAt": gateState.humanJoinedAt || new Date(),
              "metadata.escalatedAt": gateState.escalatedAt || new Date(),
              "metadata.pendingEscalation": false,
              "metadata.pendingOfflineEscalation": false,
            },
            $addToSet: { participants: agentId },
            $currentDate: { updatedAt: true },
          },
        );

        if (gateState.assignedTo !== agentId) {
          socketService.emitToConversation(conversationId, "conversation_assigned", {
            conversationId,
            agentId,
            agentName: socket.data.user.name,
          });

          // Broadcast to the whole organization so other agents' inbox lists refresh in real-time
          socketService.emitToOrg(orgId.toString(), "conversation_assigned", {
            conversationId,
            agentId,
            agentName: socket.data.user.name,
          });
        }

        // Emit message to other members of the conversation
        socket.to(`conversation:${conversationId}`).emit("new_message", {
          conversationId,
          message: {
            _id: message._id,
            senderId: message.senderId,
            content: message.content,
            type: message.type,
            metadata: message.metadata,
            createdAt: message.createdAt,
          },
        });

        if (gateState.interactionSource === "threads") {
          socketService.emitToOrg(orgId.toString(), "thread_activity", { conversationId });
        }

        // Forward agent reply to channels if applicable
        if (gateState.interactionSource !== "widget") {
          ChannelService.sendConversationReply(orgId.toString(), conversationId, content).catch((err: any) => {
            logger.error(`[handleAgentMessage] Failed to forward agent reply to channel:`, err);
          });
        }

        // Track agent first response time
        if (startedAt) {
          const responseTimeMs = Date.now() - new Date(startedAt).getTime();
          const updateResult = await Conversation.updateOne(
            {
              _id: conversationId,
              "metadata.firstAgentReplyAt": { $exists: false },
            },
            {
              $set: {
                "metadata.firstAgentReplyAt": new Date(),
                "metadata.firstAgentReplyBy": agentId,
              },
            },
          );

          if (updateResult.modifiedCount > 0) {
            tracker.trackEvent(
              orgId.toString(),
              "agent_first_response",
              "agent",
              { responseTimeMs },
              { conversationId, agentId },
            );
          }
        }
      } catch (error: any) {
        logger.error(`Error in agent send_message: ${error.message}`);
      }
    }
  );
};