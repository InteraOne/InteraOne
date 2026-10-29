import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import cors from "cors";
import helmet from "helmet";
import { Router } from "express";
import config from "@shared/infra/config";
import { connectDatabase } from "@shared/infra/database";
import { connectRedis } from "@shared/infra/redis";
import { initializeSilo } from "@shared/infra/silo";
import {
  globalRateLimit,
  errorHandler,
  notFound,
} from "@shared/security/middleware";
import SocketManager from "@sockets/index";
import { startAIResponseConsumer } from "@sockets/consumers/ai-response.consumer";
import { startAssistResponseConsumer } from "@sockets/consumers/assist.consumer";
import logger from "@shared/core/logger";
import { seedEmailTemplates } from "@shared/seeds/emailTemplates.seed";
import { authRouter } from "@modules/auth";
import { agentRouter } from "@modules/agent";
import { conversationRouter } from "@modules/conversation";
import { widgetRouter } from "@modules/widget";
import { storageRouter } from "@modules/storage";
import { knowledgeRouter } from "@modules/knowledge";
import { organizationRouter } from "@modules/organization";
import { membershipRouter } from "@modules/membership";
import { contactsRouter } from "@modules/contacts";
import { notificationRouter } from "@modules/notification";
import { analyticsRouter } from "@modules/analytics/analytics.routes";
import { ticketsRouter } from "@modules/tickets";
import { emailRouter } from "@modules/email";
import { channelsRouter } from "@modules/channels";
import { observabilityRouter } from "@modules/observability/observability.routes";
import { templatesRouter } from "@modules/templates";
import { dealsRouter } from "@modules/deals";
import { leadsRouter } from "@modules/leads";
import { accountsRouter } from "@modules/accounts";
import { leadSourcesRouter } from "@modules/lead-sources";
import { integrationsRouter } from "@modules/integrations";
import { setupSwagger } from "@shared/infra/swagger";

class Application {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private socketManager: SocketManager;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    // SocketManager sets its own module-level singleton — no setSocketManager call needed
    this.socketManager = new SocketManager(this.server);
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());

    this.app.use(
      cors({
        origin: true, // Reflect request origin — allows requests from any origin
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "X-InteraOne-Origin",
        ],
        exposedHeaders: ["Content-Range", "X-Content-Range"],
        maxAge: 86400, // 24 hours
      }),
    );

    // Rate limiting
    this.app.set("trust proxy", 1); // Trust first proxy (if behind a reverse proxy)
    this.app.use(globalRateLimit);

    // Body parsing middleware
    this.app.use(
      express.json({
        limit: "10mb",
        verify: (req: any, _res, buf) => {
          req.rawBody = buf.toString("utf8");
        },
      }),
    );
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Request logging
    this.app.use((req, res, next) => {
      const requestId = req.get("x-request-id") || randomUUID();
      const startedAt = process.hrtime.bigint();

      (req as any).requestId = requestId;
      res.setHeader("x-request-id", requestId);

      res.on("finish", () => {
        const durationMs =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const level =
          res.statusCode >= 500
            ? "error"
            : res.statusCode >= 400
              ? "warn"
              : "info";

        logger.log(level, "HTTP request completed", {
          requestId,
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs),
          contentLength: res.getHeader("content-length"),
          ip: req.ip,
          userAgent: req.get("user-agent"),
          userId: (req as any).user?.userId,
          organizationId: (req as any).user?.activeOrganizationId,
        });
      });

      logger.debug("HTTP request received", {
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      next();
    });
  }

  private setupRoutes(): void {
    const router = Router();

    // API Routes
    router.use("/auth", authRouter);
    router.use("/organizations", organizationRouter);
    router.use("/memberships", membershipRouter);
    router.use("/agent", agentRouter);
    router.use("/widget", widgetRouter);
    router.use("/conversations", conversationRouter);
    router.use("/storage", storageRouter);
    router.use("/knowledge", knowledgeRouter);
    router.use("/contacts", contactsRouter);
    router.use("/notifications", notificationRouter);
    router.use("/analytics", analyticsRouter);
    router.use("/tickets", ticketsRouter);
    router.use("/email", emailRouter);
    router.use("/channels", channelsRouter);
    router.use("/observability", observabilityRouter);
    router.use("/templates", templatesRouter);
    router.use("/deals", dealsRouter);
    router.use("/leads", leadsRouter);
    router.use("/accounts", accountsRouter);
    router.use("/crm/organizations", accountsRouter);
    router.use("/lead-sources", leadSourcesRouter);
    router.use("/integrations", integrationsRouter);

    // Public config endpoint
    router.get("/config", (req, res) => {
      const { getInteraOneMode } = require("@shared/ee");
      res.json({
        success: true,
        data: {
          mode: getInteraOneMode(),
        },
      });
    });

    // Health check
    router.get("/health", (req, res) => {
      res.json({
        success: true,
        message: "API is healthy",
        timestamp: new Date().toISOString(),
      });
    });

    // API routes
    this.app.use("/api/v1", router);

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "InteraOne API",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      });
    });

    // Swagger API Documentation
    if (config.app.env !== "production") {
      setupSwagger(this.app);
    }
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use(notFound);

    // Global error handler
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      // Connect to databases
      await connectDatabase();

      try {
        const result = await seedEmailTemplates();
        logger.info(
          `[EmailTemplate Seeder] Completed startup seed: inserted=${result.inserted}`,
        );
      } catch (error) {
        logger.error("[EmailTemplate Seeder] Startup seed failed", { error });
      }

      await connectRedis();

      // Start AI response stream consumer (background loop)
      startAIResponseConsumer();

      // Start Assist response consumer
      startAssistResponseConsumer();

      // Initialize Silo (non-blocking - log error but don't crash)
      initializeSilo().catch((error) => {
        logger.error("Silo initialization failed; will retry on first use", {
          error,
        });
      });

      // Start server
      this.server.listen(config.app.port, "0.0.0.0", () => {
        logger.info(`🚀 Server running on port ${config.app.port}`);
        logger.info(`📱 Environment: ${config.app.env}`);
        logger.info(`🔌 Socket.IO: Ready`);
        logger.info(`💾 MongoDB: Connected`);
        logger.info(`📮 Redis: Connected`);
        logger.info(`📦 Silo: Initializing...`);
      });

      // Graceful shutdown
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error("Failed to start server", { error });
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Close server
      this.server.close(() => {
        logger.info("HTTP server closed");
      });

      // Close Socket.IO
      this.socketManager.ioInstance.close(() => {
        logger.info("Socket.IO server closed");
      });

      // Close database connections would go here
      // await disconnectDatabase();
      // await disconnectRedis();

      logger.info("Graceful shutdown completed");
      process.exit(0);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("unhandledRejection", (reason, promise) => {
      const details =
        reason instanceof Error
          ? {
              errorName: reason.name,
              message: reason.message,
              stack: reason.stack,
            }
          : { message: String(reason) };
      logger.error("Unhandled promise rejection", details);
      process.exit(1);
    });

    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", {
        errorName: error.name,
        message: error.message,
        stack: error.stack,
      });
      process.exit(1);
    });
  }
}

// Start the application
const app = new Application();
app.start();

export default app;
