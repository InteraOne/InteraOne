import { describe, expect, it } from "vitest";
import { isPrivateIp } from "../../src/modules/custom-actions/custom-actions.executor";

describe("custom action destination protection", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fea0::1",
    "febf:ffff::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("blocks private destination %s", (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public destination %s",
    (address) => expect(isPrivateIp(address)).toBe(false),
  );
});
