import { Request, Response } from "express";
import { asyncHandler, sendError, sendResponse } from "@shared/core/response";
import { AuthenticatedRequest } from "@shared/security/middleware";
import { CustomActionsService } from "./custom-actions.service";

const service = new CustomActionsService();
const auth = (req: Request) => (req as AuthenticatedRequest).user;
const actionId = (req: Request) => String(req.params.actionId);

export const CustomActionsController = {
  agentTools: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Agent custom actions retrieved", await service.agentTools(req.body.organizationId, req.body.conversationId)),
  ),
  agentExecute: asyncHandler(async (req: Request, res: Response) =>
    sendResponse(res, 200, true, "Agent custom action handled", await service.executeAgentTool(req.body.organizationId, req.body.conversationId, req.body.toolName, req.body.arguments)),
  ),
  list: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 200, true, "Custom actions retrieved", await service.list(auth(req).activeOrganizationId))),
  get: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.get(auth(req).activeOrganizationId, actionId(req));
    return action ? sendResponse(res, 200, true, "Custom action retrieved", action) : sendError(res, 404, "Custom action not found");
  }),
  create: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 201, true, "Custom action created", await service.create(auth(req).activeOrganizationId, auth(req).userId, req.body))),
  update: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.update(auth(req).activeOrganizationId, auth(req).userId, actionId(req), req.body);
    return action ? sendResponse(res, 200, true, "Custom action updated", action) : sendError(res, 404, "Custom action not found");
  }),
  remove: asyncHandler(async (req: Request, res: Response) => {
    const action = await service.remove(auth(req).activeOrganizationId, auth(req).userId, actionId(req));
    return action ? sendResponse(res, 200, true, "Custom action deleted") : sendError(res, 404, "Custom action not found");
  }),
  test: asyncHandler(async (req: Request, res: Response) => sendResponse(res, 200, true, "Custom action test completed", await service.test(auth(req).activeOrganizationId, auth(req).userId, actionId(req), req.body.input))),
};
