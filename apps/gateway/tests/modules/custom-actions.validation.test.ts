import { describe, expect, it } from "vitest";
import { validateActionInput, validateActionSchema } from "../../src/modules/custom-actions/custom-actions.validation";

const schema = {
  type: "object",
  properties: {
    customerId: { type: "string", maxLength: 20 },
    active: { type: "boolean" },
  },
  required: ["customerId"],
};

describe("custom action schema validation", () => {
  it("accepts the restricted schema and matching input", () => {
    expect(() => validateActionSchema(schema)).not.toThrow();
    expect(() => validateActionInput(schema, { customerId: "cus_123", active: true })).not.toThrow();
  });

  it("rejects unknown inputs and missing required values", () => {
    expect(() => validateActionInput(schema, { active: true })).toThrow(/customerId/);
    expect(() => validateActionInput(schema, { customerId: "cus_123", secret: "x" })).toThrow(/unknown property secret/);
  });

  it("rejects executable or unbounded schema extensions", () => {
    expect(() => validateActionSchema({ ...schema, allOf: [] })).toThrow(/Unsupported inputSchema keyword/);
    expect(() => validateActionSchema({ type: "string" })).toThrow(/root type must be object/);
  });

  it("rejects arrays without an item schema", () => {
    expect(() => validateActionSchema({
      type: "object",
      properties: { values: { type: "array" } },
    })).toThrow(/require items/);
  });
});
