import { Conversation } from "@shared/models/Conversation";
import { socketService } from "@sockets/services/socket.service";
import { notifyThreadOwner } from "./notifications";

export async function handoffThread(
  organizationId: string,
  conversationId: string,
  reason: string,
) {
  const changed = await Conversation.findOneAndUpdate(
    {
      _id: conversationId,
      organizationId,
      channel: "threads",
      "metadata.thread.category": "support",
      status: "open",
      assignedTo: null,
      "metadata.escalatedAt": null,
      "metadata.humanJoinedAt": null,
    },
    {
      $set: {
        "metadata.escalatedAt": new Date(),
        "metadata.escalationReason": reason,
        "metadata.pendingEscalation": true,
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (changed) {
    socketService.emitToOrg(organizationId, "conversation_pending", {
      conversationId,
    });
    socketService.emitToConversation(conversationId, "conversation_escalated", {
      conversationId,
      reason,
    });
    void notifyThreadOwner(changed, "handoff");
  }
  return changed;
}
