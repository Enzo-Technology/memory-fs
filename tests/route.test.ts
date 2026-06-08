import { describe, expect, it } from "vitest";
import { addressToPath, parseAddress } from "../ui/src/route.js";

describe("route", () => {
  it("encodes namespace colons in the path", () => {
    expect(addressToPath("voice:onboarding", "greeting-tone")).toBe(
      "/voice%3Aonboarding/greeting-tone",
    );
  });

  it("parses a two-segment address and decodes colons", () => {
    expect(parseAddress("/voice%3Aonboarding/greeting-tone")).toEqual({
      namespace: "voice:onboarding",
      key: "greeting-tone",
    });
  });

  it("round-trips", () => {
    const path = addressToPath("a:b:c", "my-key");
    expect(parseAddress(path)).toEqual({ namespace: "a:b:c", key: "my-key" });
  });

  it("returns null for non-address paths (single segment / root)", () => {
    expect(parseAddress("/sign-in")).toBeNull();
    expect(parseAddress("/")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
});
