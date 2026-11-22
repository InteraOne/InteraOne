import { Router } from "express";
import { authenticate, requireRole, resolveOrganization, validateAiSecret, validateRequest } from "@shared/security/middleware";
import { CustomActionsController } from "./custom-actions.controller";
import { customActionsSchema } from "./custom-actions.schema";

export const customActionsRouter = Router();
customActionsRouter.post("/ai/tools", validateAiSecret, validateRequest(customActionsSchema.agentContext), CustomActionsController.agentTools);
customActionsRouter.post("/ai/execute", validateAiSecret, validateRequest(customActionsSchema.agentExecute), CustomActionsController.agentExecute);
customActionsRouter.use(authenticate, resolveOrganization, requireRole("admin"));
customActionsRouter.post("/import", validateRequest(customActionsSchema.import), CustomActionsController.import);
customActionsRouter.get("/", CustomActionsController.list);
customActionsRouter.post("/", validateRequest(customActionsSchema.create), CustomActionsController.create);
customActionsRouter.put("/bulk/status", validateRequest(customActionsSchema.bulkStatus), CustomActionsController.bulkStatus);
customActionsRouter.delete("/bulk", validateRequest(customActionsSchema.bulkDelete), CustomActionsController.bulkRemove);
customActionsRouter.get("/:actionId", validateRequest(customActionsSchema.params, "params"), CustomActionsController.get);
customActionsRouter.put("/:actionId", validateRequest(customActionsSchema.params, "params"), validateRequest(customActionsSchema.update), CustomActionsController.update);
customActionsRouter.delete("/:actionId", validateRequest(customActionsSchema.params, "params"), CustomActionsController.remove);
customActionsRouter.post("/:actionId/test", validateRequest(customActionsSchema.params, "params"), validateRequest(customActionsSchema.test), CustomActionsController.test);
