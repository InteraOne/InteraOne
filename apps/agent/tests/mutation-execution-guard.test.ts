import { describe, expect, it, vi } from "vitest";
import { createMutationExecutionGuard } from "../src/modules/agents/tools/mutation-execution-guard";

describe("connected mutation execution guard", () => {
  it("coalesces concurrent calls and reuses a confirmed successful result", async () => {
    const operation = vi.fn(async () => ({ id: "real-resource-id" }));
    const execute = createMutationExecutionGuard();

    const [first, concurrent] = await Promise.all([
      execute(operation),
      execute(operation),
    ]);
    const repeated = await execute(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(concurrent).toEqual(first);
    expect(repeated).toEqual(first);
  });

  it("allows one real retry after a failure and blocks further SDK calls", async () => {
    const operation = vi.fn(async () => {
      throw new Error("provider rejected mutation");
    });
    const execute = createMutationExecutionGuard();

    await expect(execute(operation)).rejects.toThrow(
      "provider rejected mutation",
    );
    await expect(execute(operation)).rejects.toThrow(
      "provider rejected mutation",
    );
    await expect(execute(operation)).rejects.toThrow("retry limit reached");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
