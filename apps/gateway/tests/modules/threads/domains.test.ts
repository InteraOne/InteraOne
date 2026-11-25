import { describe, expect, it } from "vitest";
import {
  domainDto,
  normalizeThreadHostname,
} from "@modules/threads/domains";

describe("Threads domains", () => {
  it("normalizes international hostnames and rejects unsafe destinations", () => {
    expect(normalizeThreadHostname("https://Support.Example.com")).toBe(
      "support.example.com",
    );
    expect(() => normalizeThreadHostname("localhost:3000")).toThrow();
    expect(() => normalizeThreadHostname("https://127.0.0.1")).toThrow();
    expect(() => normalizeThreadHostname("https://example.com/path")).toThrow();
  });

  it("does not expose a URL until both domain and TLS are active", () => {
    const dto = domainDto({
      _id: "domain-id",
      hostname: "support.example.com",
      verificationToken: "token",
      status: "provisioning",
      tlsStatus: "provisioning",
    });
    expect(dto.url).toBeUndefined();
  });
});
