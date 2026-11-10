import { Router } from "express";
import {
  authenticate,
  resolveOrganization,
  requireRole,
  validateRequest,
  validateAiSecret,
} from "@shared/security/middleware";
import * as TicketsController from "./tickets.controller";
import { ticketsSchema } from "./tickets.schema";

const router = Router();

// ─── AI-Internal Routes (x-ai-tool-secret, NO JWT) ──────────────────────────
// These are called by apps/agent tools only — not exposed to frontend.

/**
 * @openapi
 * /tickets/ai:
 *   post:
 *     summary: Create a support ticket from AI agent context
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: header
 *         name: x-ai-tool-secret
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organizationId
 *               - customerName
 *               - customerEmail
 *               - subject
 *               - description
 *             properties:
 *               organizationId:
 *                 type: string
 *               customerName:
 *                 type: string
 *               customerEmail:
 *                 type: string
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket created successfully
 *       401:
 *         description: Invalid AI secret
 */
router.post(
  "/ai",
  validateAiSecret,
  validateRequest(ticketsSchema.aiCreateTicket),
  TicketsController.aiCreateTicket,
);

/**
 * @openapi
 * /tickets/ai/{ticketId}:
 *   patch:
 *     summary: Update an existing ticket details from AI context
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: header
 *         name: x-ai-tool-secret
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *               priority:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket updated successfully
 */
router.patch(
  "/ai/:ticketId",
  validateAiSecret,
  validateRequest(ticketsSchema.aiUpdateTicket),
  TicketsController.aiUpdateTicket,
);

router.get(
  "/ai/status",
  validateAiSecret,
  TicketsController.aiGetTicketStatus,
);

/**
 * @openapi
 * /tickets/ai/{ticketId}/close:
 *   patch:
 *     summary: Close a ticket from AI context
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: header
 *         name: x-ai-tool-secret
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket closed successfully
 */
router.patch(
  "/ai/:ticketId/close",
  validateAiSecret,
  validateRequest(ticketsSchema.aiCloseTicket),
  TicketsController.aiCloseTicket,
);

// ─── Agent UI Routes (JWT required) ─────────────────────────────────────────

router.use(authenticate, resolveOrganization);

/**
 * @openapi
 * /tickets:
 *   get:
 *     summary: Retrieve list of tickets in the organization
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved tickets list
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  requireRole("agent"),
  validateRequest(ticketsSchema.listTickets, "query"),
  TicketsController.listTickets,
);

/**
 * @openapi
 * /tickets/{ticketId}:
 *   get:
 *     summary: Get detailed ticket by ID
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved ticket details
 *       404:
 *         description: Ticket not found
 */
router.get(
  "/:ticketId",
  requireRole("agent"),
  TicketsController.getTicketById,
);

/**
 * @openapi
 * /tickets:
 *   post:
 *     summary: Create a ticket by an agent
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerName
 *               - customerEmail
 *               - subject
 *               - description
 *             properties:
 *               customerName:
 *                 type: string
 *               customerEmail:
 *                 type: string
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket created successfully by agent
 */
router.post(
  "/",
  requireRole("agent"),
  validateRequest(ticketsSchema.createTicket),
  TicketsController.createTicketAgent,
);

/**
 * @openapi
 * /tickets/{ticketId}:
 *   patch:
 *     summary: Update ticket priority, status or assignee by an agent
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               priority:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket updated successfully by agent
 */
router.patch(
  "/:ticketId",
  requireRole("agent"),
  validateRequest(ticketsSchema.updateTicket),
  TicketsController.updateTicketAgent,
);

/**
 * @openapi
 * /tickets/{ticketId}/notes:
 *   post:
 *     summary: Add an internal note to a ticket
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Internal note added successfully
 */
router.post(
  "/:ticketId/notes",
  requireRole("agent"),
  validateRequest(ticketsSchema.addNote),
  TicketsController.addNoteAgent,
);

/**
 * @openapi
 * /tickets/{ticketId}/reply:
 *   post:
 *     summary: Send a reply to the customer via email for a ticket
 *     tags:
 *       - Tickets
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               idempotencyKey:
 *                 type: string
 *                 description: Alternative to the Idempotency-Key header
 *     responses:
 *       200:
 *         description: Reply sent to customer via email
 *       404:
 *         description: Ticket not found
 *       409:
 *         description: Idempotency conflict or no active email channel
 */
router.post(
  "/:ticketId/reply",
  requireRole("agent"),
  validateRequest(ticketsSchema.replyToTicket),
  TicketsController.replyToTicket,
);

export default router;
