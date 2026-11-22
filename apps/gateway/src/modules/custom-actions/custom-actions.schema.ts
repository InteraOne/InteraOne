import Joi from "joi";

const objectMap = Joi.object().pattern(Joi.string().max(100), Joi.string().max(2000)).default({});
const authentication = Joi.object({
  type: Joi.string().valid("none", "bearer", "basic", "api_key").required(),
  placement: Joi.string().valid("header", "query").optional(),
  keyName: Joi.string().trim().max(100).optional(),
  credentials: Joi.object().unknown(true).optional(),
});
const definition = {
  name: Joi.string().trim().min(1).max(100).required(),
  category: Joi.string().trim().max(80).allow("").optional(),
  slug: Joi.string().trim().lowercase().pattern(/^[a-z][a-z0-9_]*$/).max(80).required(),
  description: Joi.string().trim().min(1).max(1000).required(),
  enabled: Joi.boolean().default(false),
  audience: Joi.string().valid("public", "restricted", "verified").optional(),
  request: Joi.object({
    method: Joi.string().valid("GET", "POST", "PUT", "PATCH", "DELETE").required(),
    url: Joi.string().trim().max(2048).required(),
    headers: objectMap,
    query: objectMap,
    bodyTemplate: Joi.any().optional(),
  }).required(),
  authentication: authentication.required(),
  inputSchema: Joi.object().unknown(true).required(),
  confirmation: Joi.object({ mode: Joi.string().valid("never", "always").required() }).required(),
  execution: Joi.object({
    timeoutMs: Joi.number().integer().min(1000).max(15000).default(10000),
    maxResponseBytes: Joi.number().integer().min(1024).max(131072).default(32768),
  }).default(),
};

export const customActionsSchema = {
  import: Joi.object({
    specification: Joi.string().max(1000000).required(),
    baseUrl: Joi.string().max(1000).allow("").optional(),
    authentication: authentication.required(),
  }),
  agentContext: Joi.object({
    organizationId: Joi.string().hex().length(24).required(),
    conversationId: Joi.string().hex().length(24).required(),
  }),
  agentExecute: Joi.object({
    messageId: Joi.string().hex().length(24).optional(),
    organizationId: Joi.string().hex().length(24).required(),
    conversationId: Joi.string().hex().length(24).required(),
    toolName: Joi.string().trim().min(1).max(160).required(),
    arguments: Joi.object().default({}).required(),
  }),
  create: Joi.object(definition),
  bulkStatus: Joi.object({
    actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(1000).unique().required(),
    enabled: Joi.boolean().required(),
  }),
  bulkDelete: Joi.object({
    actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(1000).unique().required(),
  }),
  update: Joi.object(Object.fromEntries(Object.entries(definition).map(([key, value]) => [key, (value as Joi.AnySchema).optional()]))).min(1),
  params: Joi.object({ actionId: Joi.string().hex().length(24).required() }),
  test: Joi.object({
    input: Joi.object().unknown(true).default({}).required(),
    requesterEmail: Joi.string().email().max(254).optional(),
  }),
};
