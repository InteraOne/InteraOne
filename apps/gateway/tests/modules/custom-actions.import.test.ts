import { describe, expect, it } from "vitest";
import { parseActionSpec } from "../../src/modules/custom-actions/custom-actions.import";

describe("OpenAPI action import", () => {
  it("imports YAML path parameters and local JSON body references", () => {
    const result = parseActionSpec(`
openapi: 3.0.3
servers:
  - url: https://example.com/api
paths:
  /orders/{id}:
    parameters:
      - in: path
        name: id
        schema: { type: string }
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Update' }
components:
  schemas:
    Update:
      type: object
      properties:
        reason: { type: string }
`);
    expect(result.skipped).toEqual([]);
    expect(result.actions[0]).toMatchObject({
      request: { url: "https://example.com/api/orders/{{id}}", bodyTemplate: "{{body}}" },
      inputSchema: { required: ["id", "body"], properties: { body: { type: "object" } } },
      confirmation: { mode: "always" },
    });
  });

  it("reports unsupported operations while importing supported Swagger operations", () => {
    const result = parseActionSpec(JSON.stringify({
      swagger: "2.0", host: "example.com", basePath: "/v1",
      paths: { "/orders": { get: {}, post: { parameters: [{ $ref: "https://example.com/parameters" }] } } },
    }));
    expect(result.actions.map(action => action.request.url)).toEqual(["https://example.com/v1/orders"]);
    expect(result.skipped).toEqual(["POST /orders: External references are unsupported"]);
  });

  it("imports parameters with omitted types and runtime context parameters", () => {
    const result = parseActionSpec(JSON.stringify({
      openapi: "3.0.3",
      servers: [{ url: "https://example.com" }],
      paths: {
        "/organizations/{orgId}/actions/{actionId}": {
          put: {
            parameters: [
              { in: "path", name: "orgId", required: true, schema: {} },
              { in: "path", name: "actionId", required: true, schema: {} },
            ],
            requestBody: {
              required: true,
              content: { "application/json": { schema: {} } },
            },
          },
        },
      },
    }));

    expect(result.skipped).toEqual([]);
    expect(result.actions[0]).toMatchObject({
      request: {
        url: "https://example.com/organizations/{{orgId}}/actions/{{actionId}}",
        bodyTemplate: "{{body}}",
      },
      inputSchema: {
        properties: {
          orgId: { type: "string", description: "Automatically provided by InteraOne" },
          actionId: { type: "string" },
          body: { type: "object" },
        },
        required: ["actionId", "body"],
      },
    });
  });

  it("imports up to 1,000 operations without skipping any", () => {
    const paths = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [
      `/operation-${index + 1}`,
      { get: {} },
    ]));

    const result = parseActionSpec(JSON.stringify({
      openapi: "3.0.3",
      servers: [{ url: "https://example.com" }],
      paths,
    }));

    expect(result.actions).toHaveLength(1_000);
    expect(result.skipped).toEqual([]);
  });

  it("rejects specifications exceeding the 1,000 operation quota", () => {
    const paths = Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [
      `/operation-${index + 1}`,
      { get: {} },
    ]));

    expect(() => parseActionSpec(JSON.stringify({
      openapi: "3.0.3",
      servers: [{ url: "https://example.com" }],
      paths,
    }))).toThrow("Import supports up to 1000 operations per specification");
  });
});
