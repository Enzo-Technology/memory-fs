import { describe, expect, it } from "vitest";
import { assertOrgMember } from "../src/lib/org-gate.js";

describe("assertOrgMember", () => {
  const allowed = "example.com";

  it("accepts a verified member of the allowed domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "example.com" }, allowed),
    ).not.toThrow();
  });

  it("rejects a different hosted domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "evil.com" }, allowed),
    ).toThrow(/not "example.com"/);
  });

  it("rejects a consumer account with no hd claim", () => {
    expect(() =>
      assertOrgMember({ email_verified: true }, allowed),
    ).toThrow(/not "example.com"/);
  });

  it("rejects an unverified email even on the right domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: false, hd: "example.com" }, allowed),
    ).toThrow(/not verified/);
  });

  it("accepts any account when allowed is '*'", () => {
    expect(() =>
      assertOrgMember({ email_verified: false }, "*"),
    ).not.toThrow();
  });

  it("matches the domain case-insensitively", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "example.com" }, "Example.COM"),
    ).not.toThrow();
  });

  it("throws on an empty allowed domain (misconfiguration)", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "example.com" }, ""),
    ).toThrow(/misconfiguration/);
  });
});
