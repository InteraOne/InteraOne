import type { Schema } from "joi";
import { accountsSchema } from "@modules/accounts/accounts.schema";
import { customActionsSchema } from "@modules/custom-actions/custom-actions.schema";
import { dealsSchema } from "@modules/deals/deals.schema";
import { integrationsSchema } from "@modules/integrations/integrations.schema";
import { leadSourcesSchema } from "@modules/lead-sources/lead-sources.schema";
import { leadsSchema } from "@modules/leads/leads.schema";

interface Operation {
  method: string;
  path: string;
  summary: string;
  role?: "agent" | "admin";
  status?: number;
  body?: Schema;
  query?: Schema;
  params?: Schema;
}

const groups: Array<{ tag: string; prefixes: string[]; role: string; operations: Operation[] }> = [
  {
    tag: "Accounts", prefixes: ["/accounts", "/crm/organizations"], role: "agent",
    operations: [
      { method: "get", path: "", summary: "List accounts", query: accountsSchema.list },
      { method: "post", path: "", summary: "Create account", body: accountsSchema.create, status: 201 },
      { method: "get", path: "/{id}", summary: "Get account" },
      { method: "patch", path: "/{id}", summary: "Update account", body: accountsSchema.update },
      { method: "post", path: "/{id}/notes", summary: "Add Note", body: accountsSchema.addNote, status: 201 },
      { method: "patch", path: "/{id}/notes/{noteId}", summary: "Update Note", body: accountsSchema.updateNote },
      { method: "delete", path: "/{id}/notes/{noteId}", summary: "Delete Note" },
      { method: "post", path: "/{id}/activities", summary: "Add Activity", body: accountsSchema.addActivity, status: 201 },
      { method: "patch", path: "/{id}/activities/{activityId}", summary: "Update Activity", body: accountsSchema.updateActivity },
      { method: "patch", path: "/{id}/activities/{activityId}/status", summary: "Update Activity Status", body: accountsSchema.updateActivityStatus },
      { method: "delete", path: "/{id}/activities/{activityId}", summary: "Delete Activity" },
      { method: "post", path: "/{id}/timeline", summary: "Add Timeline Item", body: accountsSchema.addTimelineItem, status: 201 },
      { method: "patch", path: "/{id}/timeline/{itemId}", summary: "Update Timeline Item", body: accountsSchema.updateTimelineItem },
      { method: "delete", path: "/{id}/timeline/{itemId}", summary: "Delete Timeline Item" },
    ],
  },
  {
    tag: "Custom Actions", prefixes: ["/actions"], role: "admin",
    operations: [
      { method: "post", path: "/import", summary: "Import OpenAPI specification", body: customActionsSchema.import, status: 201 },
      { method: "get", path: "", summary: "List custom actions" },
      { method: "post", path: "", summary: "Create custom action", body: customActionsSchema.create, status: 201 },
      { method: "get", path: "/{actionId}", summary: "Get custom action", params: customActionsSchema.params },
      { method: "put", path: "/{actionId}", summary: "Update custom action", params: customActionsSchema.params, body: customActionsSchema.update },
      { method: "delete", path: "/{actionId}", summary: "Delete custom action", params: customActionsSchema.params },
      { method: "post", path: "/{actionId}/test", summary: "Test custom action", params: customActionsSchema.params, body: customActionsSchema.test },
    ],
  },
  {
    tag: "Deals", prefixes: ["/deals"], role: "agent",
    operations: [
      { method: "get", path: "/pipeline", summary: "Get Pipeline" },
      { method: "put", path: "/pipeline", summary: "Update Pipeline", body: dealsSchema.updatePipeline, role: "admin" },
      { method: "get", path: "", summary: "List deals" },
      { method: "post", path: "", summary: "Create deal", body: dealsSchema.create, status: 201 },
      { method: "patch", path: "/{id}", summary: "Update deal", body: dealsSchema.update },
      { method: "delete", path: "/{id}", summary: "Delete deal" },
      { method: "patch", path: "/{id}/stage", summary: "Update Stage", body: dealsSchema.updateStage },
      { method: "patch", path: "/{id}/color", summary: "Update Color", body: dealsSchema.updateColor },
      { method: "patch", path: "/{id}/priority", summary: "Update Priority", body: dealsSchema.updatePriority },
      { method: "patch", path: "/{id}/move", summary: "Move", body: dealsSchema.move },
      { method: "patch", path: "/{id}/next-action", summary: "Update Next Action", body: dealsSchema.updateNextAction },
      { method: "post", path: "/{id}/activities", summary: "Add Activity", body: dealsSchema.addActivity, status: 201 },
      { method: "patch", path: "/{id}/activities/{activityId}/complete", summary: "Complete Activity" },
      { method: "patch", path: "/{id}/activities/{activityId}", summary: "Update Activity", body: dealsSchema.updateActivity },
      { method: "delete", path: "/{id}/activities/{activityId}", summary: "Delete Activity" },
    ],
  },
  {
    tag: "Integrations", prefixes: ["/integrations"], role: "admin",
    operations: [
      { method: "get", path: "/catalog", summary: "List integration catalog", query: integrationsSchema.catalogQuery },
      { method: "get", path: "/catalog/{toolkit}", summary: "Get integration toolkit", params: integrationsSchema.toolkitParams },
      { method: "put", path: "/{toolkit}/policy", summary: "Update Policy", params: integrationsSchema.toolkitParams, body: integrationsSchema.updatePolicy },
      { method: "get", path: "/connections", summary: "List Connections" },
      { method: "post", path: "/{toolkit}/connect", summary: "Create toolkit authorization link", params: integrationsSchema.toolkitParams },
      { method: "get", path: "/{toolkit}/connection-status", summary: "Get toolkit connection status", params: integrationsSchema.toolkitParams },
      { method: "delete", path: "/connections/{connectionId}", summary: "Disconnect integration", params: integrationsSchema.connectionParams },
    ],
  },
  {
    tag: "Lead Sources", prefixes: ["/lead-sources"], role: "agent",
    operations: [
      { method: "get", path: "", summary: "List lead sources" },
      { method: "get", path: "/facebook/connect", summary: "Begin Facebook authorization", role: "admin" },
      { method: "get", path: "/google/connect", summary: "Begin Google authorization", role: "admin" },
      { method: "get", path: "/google-calendar/connect", summary: "Begin Google Calendar authorization", role: "admin" },
      { method: "get", path: "/google-tasks/connect", summary: "Begin Google Tasks authorization", role: "admin" },
      { method: "post", path: "/{connectionId}/calendars/sync", summary: "Sync Google Calendars", params: leadSourcesSchema.connectionParams, role: "admin" },
      { method: "post", path: "/{connectionId}/task-lists/sync", summary: "Sync Google Task Lists", params: leadSourcesSchema.connectionParams, role: "admin" },
      { method: "post", path: "/{connectionId}/forms/sync", summary: "Sync Forms", params: leadSourcesSchema.connectionParams, role: "admin" },
      { method: "patch", path: "/forms/{formId}", summary: "Update Form", params: leadSourcesSchema.formParams, body: leadSourcesSchema.updateForm, role: "admin" },
      { method: "delete", path: "/{connectionId}", summary: "Delete Connection", params: leadSourcesSchema.connectionParams, role: "admin" },
      { method: "get", path: "/submissions", summary: "List Submissions", query: leadSourcesSchema.listSubmissions },
      { method: "post", path: "/submissions/{submissionId}/retry", summary: "Retry Submission", params: leadSourcesSchema.submissionParams, status: 202, role: "admin" },
    ],
  },
  {
    tag: "Leads", prefixes: ["/leads"], role: "agent",
    operations: [
      { method: "get", path: "", summary: "List leads" },
      { method: "post", path: "", summary: "Create lead", body: leadsSchema.create, status: 201 },
      { method: "post", path: "/{id}/convert-to-deal", summary: "Convert To Deal" },
      { method: "patch", path: "/{id}", summary: "Update lead", body: leadsSchema.update },
      { method: "delete", path: "/{id}", summary: "Delete lead" },
      { method: "patch", path: "/{id}/stage", summary: "Update Stage", body: leadsSchema.updateStage },
      { method: "patch", path: "/{id}/color", summary: "Update Color", body: leadsSchema.updateColor },
      { method: "patch", path: "/{id}/priority", summary: "Update Priority", body: leadsSchema.updatePriority },
      { method: "patch", path: "/{id}/move", summary: "Move", body: leadsSchema.move },
      { method: "patch", path: "/{id}/next-action", summary: "Update Next Action", body: leadsSchema.updateNextAction },
      { method: "post", path: "/{id}/activities", summary: "Add Activity", body: leadsSchema.addActivity, status: 201 },
      { method: "patch", path: "/{id}/activities/{activityId}/complete", summary: "Complete Activity" },
      { method: "patch", path: "/{id}/activities/{activityId}", summary: "Update Activity", body: leadsSchema.updateActivity },
      { method: "delete", path: "/{id}/activities/{activityId}", summary: "Delete Activity" },
    ],
  },
];

interface JoiDescription {
  type?: string;
  flags?: { presence?: string; only?: boolean; description?: string; default?: unknown };
  allow?: unknown[];
  keys?: Record<string, JoiDescription>;
  items?: JoiDescription[];
  rules?: Array<{ name: string; args?: { limit?: unknown; regex?: string } }>;
  patterns?: Array<{ rule: JoiDescription }>;
}

// Translate the subset used by these request validators. Validation stays in Joi.
function requestSchema(description: JoiDescription): Record<string, unknown> {
  const { type = "any", flags, keys, items, allow = [], rules = [], patterns } = description;
  const result: Record<string, unknown> = {};
  if (type === "date") Object.assign(result, { type: "string", format: "date-time" });
  else if (type !== "any") result.type = type;
  if (allow.includes(null) && result.type) result.nullable = true;
  if (flags?.only) result.enum = allow;
  if (flags?.description) result.description = flags.description;
  if (flags?.default !== undefined && typeof flags.default !== "object") result.default = flags.default;
  if (keys) {
    result.properties = Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, requestSchema(value)]));
    const required = Object.entries(keys).filter(([, value]) => value.flags?.presence === "required").map(([key]) => key);
    if (required.length) result.required = required;
  }
  if (type === "array") result.items = items?.length === 1 ? requestSchema(items[0]) : {};
  if (patterns?.length === 1) result.additionalProperties = requestSchema(patterns[0].rule);
  const limits: Record<string, [string, string]> = {
    string: ["minLength", "maxLength"], number: ["minimum", "maximum"],
    array: ["minItems", "maxItems"], object: ["minProperties", "maxProperties"],
  };
  for (const { name, args } of rules) {
    const range = limits[type];
    const limit = args?.limit;
    if (typeof limit === "number" && range) {
      if (name === "min" || name === "length") result[range[0]] = limit;
      if (name === "max" || name === "length") result[range[1]] = limit;
    }
    if (name === "integer") result.type = "integer";
    if (name === "email") result.format = "email";
    if (name === "hex") result.pattern = "^[0-9a-fA-F]+$";
    if (name === "pattern" && args?.regex) result.pattern = args.regex.slice(1, args.regex.lastIndexOf("/"));
  }
  return result;
}

export function supplementalPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { tag, prefixes, role, operations } of groups) {
    for (const prefix of prefixes) {
      for (const operation of operations) {
        const path = prefix + operation.path;
        const pathInputs: Record<string, JoiDescription> = operation.params?.describe().keys ?? {};
        const queryInputs: Record<string, JoiDescription> = operation.query?.describe().keys ?? {};
        const parameters = [
          ...Array.from(path.matchAll(/\{(\w+)\}/g), ([, name]) => ({
            in: "path", name, required: true,
            schema: requestSchema(pathInputs[name] ?? {
              type: "string",
              rules: [{ name: "hex" }, { name: "length", args: { limit: 24 } }],
            }),
          })),
          ...Object.entries(queryInputs).map(([name, field]) => ({
            in: "query", name, required: field.flags?.presence === "required", schema: requestSchema(field),
          })),
        ];

        (paths[path] ??= {})[operation.method] = {
          tags: [tag],
          summary: operation.summary,
          description: `Requires the ${operation.role ?? role} role or higher in the active organization.`,
          security: [{ BearerAuth: [] }],
          ...(parameters.length && { parameters }),
          ...(operation.body && {
            requestBody: {
              required: true,
              content: { "application/json": { schema: requestSchema(operation.body.describe()) } },
            },
          }),
          responses: {
            [operation.status ?? 200]: { description: "Successful request" },
            400: { description: "Invalid request" },
            401: { description: "Authentication required" },
            403: { description: "Insufficient permissions" },
          },
        };
      }
    }
  }
  return paths;
}
