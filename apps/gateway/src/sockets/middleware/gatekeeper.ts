import { Conversation } from "@shared/models";
import { redisClient } from "@shared/infra/redis";
import logger from "@shared/core/logger";

export const gatekeeperMiddleware = (socket: any) => {
  return async (packet: any[], next: (err?: Error) => void) => {
    const [event, data] = packet;
    if (
      event === "send_message" ||
      event === "join_conversation" ||
      event === "typing_start" ||
      event === "typing_stop"
    ) {
      const conversationId =
        typeof data === "string" ? data : data?.conversationId;
      if (conversationId) {
        try {
          const orgId = socket.data.user?.orgId;
          if (!orgId) {
            return next(new Error("Unauthorized: No organization assigned to socket"));
          }

          const cacheKey = `conversation:${conversationId}:gate`;
          const cached = await redisClient.get(cacheKey);

          let gateState: any = null;
          if (cached) {
            gateState = JSON.parse(cached);
          } else {
            const conversation = await Conversation.findById(conversationId)
              .select("organizationId sessionId metadata assignedTo status channel")
              .lean();

            if (conversation) {
              gateState = {
                organizationId: conversation.organizationId.toString(),
                assignedTo: conversation.assignedTo?.toString() || null,
                status: conversation.status,
                escalatedAt: (conversation.metadata as any)?.escalatedAt || null,
                humanJoinedAt: (conversation.metadata as any)?.humanJoinedAt || null,
                customerStartedAt: (conversation.metadata as any)?.customer?.startedAt || null,
                interactionSource:
                  conversation.channel ||
                  (conversation.metadata as any)?.interactionSource ||
                  (conversation.metadata as any)?.source ||
                  "widget",
              };
              await redisClient.set(cacheKey, JSON.stringify(gateState), { EX: 600 });
            }
          }

          if (!gateState) {
            return next(new Error("Conversation not found"));
          }

          if (socket.data.user.isWidget && gateState.interactionSource === "threads") {
            return next(new Error("Conversation not found"));
          }
          if (gateState.organizationId !== orgId.toString()) {
            logger.warn(
              `Unauthorized conversation access attempt: user org=${orgId}, conversation org=${gateState.organizationId}`,
            );
            return next(new Error("Unauthorized conversation access"));
          }

          socket.data.gateState = gateState;
        } catch (err: any) {
          logger.error(
            `Error in socket packet authorization middleware: ${err.message}`,
          );
          return next(err);
        }
      }
    }
    next();
  };
};
