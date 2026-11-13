import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import config from "@shared/infra/config";
import logger from "@shared/core/logger";
import { AppError } from "@shared/core/errors";

export const globalRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const billingWebhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: "Too many webhook requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const statusCode = (error as any).statusCode || 500;
  const requestId = (req as any).requestId || req.get("x-request-id");
  const user = (req as any).user;

  logger.error("Unhandled request error", {
    requestId,
    statusCode,
    errorName: error.name,
    message: error.message,
    stack: error.stack,
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    userId: user?.userId,
    organizationId: user?.activeOrganizationId,
  });

  // AppError messages and codes are deliberately authored for callers. Keep
  // unexpected exception details private in production, while allowing the
  // agent to recover from validation/policy failures without guessing.
  const isAppError = error instanceof AppError;
  const message =
    config.app.env === "production" && !isAppError
      ? "Something went wrong!"
      : error.message;

  res.status(statusCode).json({
    success: false,
    message,
    requestId,
    ...(isAppError && error.code ? { code: error.code } : {}),
    ...(config.app.env !== "production" && { stack: error.stack }),
  });
};

export const notFound = (req: Request, res: Response): void => {
  logger.warn("Route not found", {
    requestId: (req as any).requestId || req.get("x-request-id"),
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });

  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    requestId: (req as any).requestId || req.get("x-request-id"),
  });
};
