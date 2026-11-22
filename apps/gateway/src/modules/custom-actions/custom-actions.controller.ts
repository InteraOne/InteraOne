import { Request, Response } from "express";
import { asyncHandler, sendError, sendResponse } from "@shared/core/response";
import { AuthenticatedRequest } from "@shared/security/middleware";
import { CustomActionsService } from "./custom-actions.service";

const service = new CustomActionsService();
const auth = (req: Request) => (req as AuthenticatedRequest).user;
const actionId = (req: Request) => String(req.params.actionId);

export const CustomActionsController = {
  import: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 201, true, "Actions imported as drafts", await service.importSpec(auth(req).activeOrganizationId, auth(req).userId, req.body)),
  ),
  agentTools: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Agent custom actions retrieved", await service.agentTools(req.body.organizationId, req.body.conversationId)),
  ),
  agentExecute: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Agent custom action handled", await service.executeAgentTool(req.body.organizationId, req.body.conversationId, req.body.toolName, req.body.arguments, req.body.messageId)),
  ),
  list: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 200, true, "Custom actions retrieved", await service.list(auth(req).activeOrganizationId))),
  get: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.get(auth(req).activeOrganizationId, actionId(req));
    return action ? sendResponse(res, 200, true, "Custom action retrieved", action) : sendError(res, 404, "Custom action not found");
  }),
  create: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 201, true, "Custom action created", await service.create(auth(req).activeOrganizationId, auth(req).userId, req.body))),
  bulkStatus: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Custom action statuses updated", await service.bulkStatus(auth(req).activeOrganizationId, auth(req).userId, req.body.actionIds, req.body.enabled)),
  ),
  bulkRemove: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Custom actions deleted", await service.bulkRemove(auth(req).activeOrganizationId, auth(req).userId, req.body.actionIds)),
  ),
  update: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.update(auth(req).activeOrganizationId, auth(req).userId, actionId(req), req.body);
    return action ? sendResponse(res, 200, true, "Custom action updated", action) : sendError(res, 404, "Custom action not found");
  }),
  remove: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.remove(auth(req).activeOrganizationId, auth(req).userId, actionId(req));
    return action ? sendResponse(res, 200, true, "Custom action deleted") : sendError(res, 404, "Custom action not found");
  }),
  test: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 200, true, "Custom action test completed", await service.test(auth(req).activeOrganizationId, auth(req).userId, actionId(req), req.body.input, req.body.requesterEmail))),
};
