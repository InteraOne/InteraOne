import Joi from "joi";

const slug = Joi.string().trim().min(1).max(160);

export const integrationsSchema = {
  catalogQuery: Joi.object({
    page: Joi.number().integer().min(1).max(10000).optional(),
    limit: Joi.number().integer().min(1).max(48).optional(),
    search: Joi.string().trim().max(120).allow("").optional(),
  }),
  toolkitParams: Joi.object({
    toolkit: Joi.string().trim().lowercase().min(1).max(80).required(),
  }),
  connectionParams: Joi.object({
    connectionId: Joi.string().hex().length(24).required(),
  }),
  approvalParams: Joi.object({ id: Joi.string().hex().length(24).required() }),
  execute: Joi.object({
    connectionId: Joi.string().hex().length(24).required(),
    toolSlug: slug.required(),
    arguments: Joi.object().default({}).required(),
  }),
  updatePolicy: Joi.object({
    enabled: Joi.boolean().required(),
    allowedTools: Joi.array()
      .items(
        Joi.object({
          slug: slug.required(),
          risk: Joi.string().valid("read", "write", "sensitive").required(),
        }),
      )
      .max(1000)
      .required(),
  }),
};
