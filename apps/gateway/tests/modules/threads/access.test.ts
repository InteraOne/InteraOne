import { describe, it, expect } from "vitest";
import { threadScope } from "@modules/threads/access";
describe("portal access", () => {
  it("requires identity for My Threads", () =>
    expect(() => threadScope("org", undefined, true)).toThrow());
  it("restricts anonymous access to public community categories", () =>
    expect(threadScope("org")).toEqual({
      organizationId: "org",
      channel: "threads",
      "metadata.thread.public": true,
      "metadata.thread.category": { $in: ["discussion", "feature"] },
    }));
  it("binds private reads to the tenant and owner", () =>
    expect(threadScope("org", "owner", true)).toEqual({
      organizationId: "org",
      channel: "threads",
      "metadata.thread.owner": "owner",
    }));
  it("allows a signed-in reader to open public posts and their own private threads", () => {
    expect(threadScope("org", "owner")).toMatchObject({
      organizationId: "org",
      channel: "threads",
      $or: [
        { "metadata.thread.public": true },
        { "metadata.thread.owner": "owner" },
      ],
    });
  });
});
