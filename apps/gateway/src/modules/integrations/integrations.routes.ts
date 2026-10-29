import { Router } from "express";
import { authenticate, requireRole, resolveOrganization, validateRequest } from "@shared/security/middleware";
import { IntegrationsController } from "./integrations.controller";
import { integrationsSchema } from "./integrations.schema";

export const integrationsRouter = Router();

integrationsRouter.use(authenticate, resolveOrganization, requireRole("admin"));
integrationsRouter.get("/catalog", IntegrationsController.catalog);
integrationsRouter.put("/:toolkit/policy", validateRequest(integrationsSchema.toolkitParams, "params"), validateRequest(integrationsSchema.updatePolicy), IntegrationsController.updatePolicy);
integrationsRouter.get("/connections", IntegrationsController.listConnections);
integrationsRouter.post("/:toolkit/connect", validateRequest(integrationsSchema.toolkitParams, "params"), IntegrationsController.connect);
integrationsRouter.get("/:toolkit/connection-status", validateRequest(integrationsSchema.toolkitParams, "params"), IntegrationsController.status);
integrationsRouter.delete("/connections/:connectionId", validateRequest(integrationsSchema.connectionParams, "params"), IntegrationsController.disconnect);
integrationsRouter.post("/tools/execute", validateRequest(integrationsSchema.execute), IntegrationsController.execute);
integrationsRouter.get("/approvals", IntegrationsController.approvals);
integrationsRouter.post("/approvals/:id/approve", validateRequest(integrationsSchema.approvalParams, "params"), IntegrationsController.approve);
integrationsRouter.post("/approvals/:id/reject", validateRequest(integrationsSchema.approvalParams, "params"), IntegrationsController.reject);
