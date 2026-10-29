import { Response } from "express";
import { asyncHandler, sendResponse } from "@shared/core/response";
import { AuthenticatedRequest } from "@shared/security/middleware/auth";
import { IntegrationsService } from "./integrations.service";

const service = new IntegrationsService();
const param = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] : value || "";

export const IntegrationsController = {
  catalog: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration catalog retrieved", await service.catalog(req.user.activeOrganizationId))),
  updatePolicy: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration policy updated", await service.updatePolicy(req.user.activeOrganizationId, req.user.userId, param(req.params.toolkit), req.body))),
  listConnections: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration connections retrieved", await service.listConnections(req.user.activeOrganizationId, req.user.userId))),
  connect: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 201, true, "Authorization link created", await service.connect(req.user.activeOrganizationId, req.user.userId, param(req.params.toolkit)))),
  status: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration status retrieved", await service.reconcile(req.user.activeOrganizationId, req.user.userId, param(req.params.toolkit)))),
  disconnect: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration disconnected", await service.disconnect(req.user.activeOrganizationId, req.user.userId, param(req.params.connectionId)))),
  execute: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration action handled", await service.requestExecution(req.user.activeOrganizationId, req.user.userId, req.body))),
  approvals: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration approvals retrieved", await service.listApprovals(req.user.activeOrganizationId))),
  approve: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration action approved and executed", await service.approveAndExecute(req.user.activeOrganizationId, req.user.userId, param(req.params.id)))),
  reject: asyncHandler(async (req: AuthenticatedRequest, res: Response) => sendResponse(res, 200, true, "Integration action rejected", await service.rejectApproval(req.user.activeOrganizationId, req.user.userId, param(req.params.id)))),
};
