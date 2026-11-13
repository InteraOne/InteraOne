import { Router } from "express";
import {
  authenticate,
  requireRole,
  resolveOrganization,
  validateAiSecret,
  validateRequest,
} from "@shared/security/middleware";
import { IntegrationsController } from "./integrations.controller";
import { integrationsSchema } from "./integrations.schema";

export const integrationsRouter = Router();

// The AI service receives only native, tenant-scoped Composio session tools.
integrationsRouter.post(
  "/ai/session",
  validateAiSecret,
  validateRequest(integrationsSchema.agentSession),
  IntegrationsController.agentSession,
);
integrationsRouter.post(
  "/ai/session/execute",
  validateAiSecret,
  validateRequest(integrationsSchema.agentExecute),
  IntegrationsController.agentExecute,
);

integrationsRouter.use(authenticate, resolveOrganization, requireRole("admin"));
integrationsRouter.get(
  "/catalog",
  validateRequest(integrationsSchema.catalogQuery, "query"),
  IntegrationsController.catalog,
);
integrationsRouter.get(
  "/catalog/:toolkit",
  validateRequest(integrationsSchema.toolkitParams, "params"),
  IntegrationsController.toolkit,
);
integrationsRouter.put(
  "/:toolkit/policy",
  validateRequest(integrationsSchema.toolkitParams, "params"),
  validateRequest(integrationsSchema.updatePolicy),
  IntegrationsController.updatePolicy,
);
integrationsRouter.get("/connections", IntegrationsController.listConnections);
integrationsRouter.post(
  "/:toolkit/connect",
  validateRequest(integrationsSchema.toolkitParams, "params"),
  IntegrationsController.connect,
);
integrationsRouter.get(
  "/:toolkit/connection-status",
  validateRequest(integrationsSchema.toolkitParams, "params"),
  IntegrationsController.status,
);
integrationsRouter.delete(
  "/connections/:connectionId",
  validateRequest(integrationsSchema.connectionParams, "params"),
  IntegrationsController.disconnect,
);
