import Joi from "joi";

export const ticketsSchema = {
  // ── AI-internal: create ────────────────────────────────────────────────────
  aiCreateTicket: Joi.object({
    organizationId: Joi.string().required(),
    conversationId: Joi.string().allow("", null),
    contactId: Joi.string().allow("", null),
    title: Joi.string().trim().min(1).max(300).required(),
    description: Joi.string().trim().max(10000).allow("", null),
    priority: Joi.string().valid("low", "medium", "high", "urgent"),
    status: Joi.string().valid("open", "in_progress", "resolved", "closed"),
    requesterName: Joi.string().trim().min(2).max(120).required(),
    requesterEmail: Joi.string().trim().email().required(),
    source: Joi.string().valid("ai", "widget", "email", "whatsapp", "telegram"),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
    idempotencyKey: Joi.string().trim().max(200),
  }),

  // ── AI-internal: update ────────────────────────────────────────────────────
  aiUpdateTicket: Joi.object({
    organizationId: Joi.string().required(),
    title: Joi.string().trim().min(1).max(300),
    description: Joi.string().trim().max(10000).allow("", null),
    priority: Joi.string().valid("low", "medium", "high", "urgent"),
    status: Joi.string().valid("open", "in_progress", "resolved", "closed"),
    assignedTo: Joi.string().allow("", null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }),

  // ── AI-internal: close ─────────────────────────────────────────────────────
  aiCloseTicket: Joi.object({
    organizationId: Joi.string().required(),
    resolutionNote: Joi.string().trim().max(5000).allow("", null),
  }),

  // ── Agent UI: create ───────────────────────────────────────────────────────
  createTicket: Joi.object({
    conversationId: Joi.string().allow("", null),
    contactId: Joi.string().allow("", null),
    title: Joi.string().trim().min(1).max(300).required(),
    description: Joi.string().trim().max(10000).allow("", null),
    priority: Joi.string().valid("low", "medium", "high", "urgent"),
    source: Joi.string().valid("agent", "widget", "email", "whatsapp", "telegram"),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }),

  // ── Agent UI: update ───────────────────────────────────────────────────────
  updateTicket: Joi.object({
    title: Joi.string().trim().min(1).max(300),
    description: Joi.string().trim().max(10000).allow("", null),
    priority: Joi.string().valid("low", "medium", "high", "urgent"),
    status: Joi.string().valid("open", "in_progress", "resolved", "closed"),
    assignedTo: Joi.string().allow("", null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }),

  // ── Agent UI: list filters ─────────────────────────────────────────────────
  listTickets: Joi.object({
    status: Joi.string().valid("open", "in_progress", "resolved", "closed"),
    priority: Joi.string().valid("low", "medium", "high", "urgent"),
    assignedTo: Joi.string(),
    limit: Joi.number().integer().min(1).max(100).default(50),
    page: Joi.number().integer().min(1).default(1),
  }),

  // ── Agent UI: add note ─────────────────────────────────────────────────────
  addNote: Joi.object({
    content: Joi.string().trim().min(1).max(5000).required(),
  }),

  // ── Agent UI: reply to customer via email ─────────────────────────────────
  replyToTicket: Joi.object({
    content: Joi.string().trim().min(1).max(10000).required(),
    idempotencyKey: Joi.string().trim().max(200).optional(),
  }),
};
