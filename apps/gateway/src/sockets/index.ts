import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import {
  redisClient,
  redisPublisher,
  redisSubscriber,
} from "@shared/infra/redis";
import logger from "@shared/core/logger";
import config from "@shared/infra/config";
import { authMiddleware } from "./middleware/auth";
import { subscriptionMiddleware } from "./middleware/subscription";
import { gatekeeperMiddleware } from "./middleware/gatekeeper";
import { registerConnectionHandlers } from "./handlers";
import { socketService } from "./services/socket.service";
import { updateUserStatus } from "./utils/status";

export class SocketManager {
  private io: Server;
  // userId -> { socketId, orgId }
  private connectedUsers = new Map<
    string,
    { socketId: string; orgId: string }
  >();

  constructor(server: any) {
    this.io = new Server(server, {
      cors: {
        origin: config.cors.allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    this.setupRedisAdapter();
    this.setupMiddleware();
    this.setupEventHandlers();

    // Initialize the broadcasting socketService instance
    socketService.init(this.io);
  }

  public get ioInstance() {
    return this.io;
  }

  private async setupRedisAdapter(): Promise<void> {
    try {
      const adapter = createAdapter(redisPublisher, redisSubscriber);
      this.io.adapter(adapter);
      logger.info("Socket.IO Redis adapter configured");
    } catch (error) {
      logger.error("Failed to setup Redis adapter:", error);
    }
  }

  private setupMiddleware(): void {
    this.io.use(authMiddleware);
    this.io.use(subscriptionMiddleware);
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket) => {
      const { userId, orgId, isWidget } = socket.data.user;
      logger.info(
        `${isWidget ? "Widget" : "User"} connected: ${userId} (org: ${orgId})`,
      );

      // Store connection in memory + Redis (org-scoped key)
      this.connectedUsers.set(userId, { socketId: socket.id, orgId });
      redisClient
        .set(`org:${orgId}:socket:user:${userId}`, socket.id, { EX: 86400 })
        .catch(() => { });

      // Join rooms
      if (!isWidget) socket.join(`org:${orgId}`);
      socket.join(`user:${userId}`);

      // Register packet-level authorization and cache middleware
      socket.use(gatekeeperMiddleware(socket));

      // Register connection message/room handlers
      registerConnectionHandlers({ socket, io: this.io });

      // Handle custom user connection updates
      if (!isWidget) {
        updateUserStatus(userId, "online");
      }

      socket.on("disconnect", () => {
        logger.info(`${isWidget ? "Widget" : "User"} disconnected: ${userId}`);
        this.connectedUsers.delete(userId);
        redisClient.del(`org:${orgId}:socket:user:${userId}`).catch(() => { });
        if (!isWidget) {
          updateUserStatus(userId, "offline");
        }
      });

      socket.on("update_status", async (status: string) => {
        if (!isWidget) {
          await updateUserStatus(userId, status);
          this.io.to(`org:${orgId}`).emit("user_status_update", {
            userId,
            status,
            timestamp: new Date(),
          });
        }
      });
    });
  }
}

export default SocketManager;
