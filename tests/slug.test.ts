import { describe, expect, it } from "vitest";
import { slugify, deriveKey } from "../src/core/slug.js";

describe("slugify", () => {
  it("lowercases and kebabs", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
  it("collapses repeated separators", () => {
    expect(slugify("foo - bar  baz")).toBe("foo-bar-baz");
  });
  it("strips non-alphanumerics except dash", () => {
    expect(slugify("auth_rewrite (v2)")).toBe("auth-rewrite-v2");
  });
  it("truncates to 60 chars on a word boundary", () => {
    const long = "a".repeat(70) + " end";
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
  it("empties fall back to 'note'", () => {
    expect(slugify("!!!")).toBe("note");
    expect(slugify("")).toBe("note");
  });
});

describe("deriveKey", () => {
  it("uses first h1", () => {
    expect(deriveKey("# Auth Decision\n\nBody")).toBe("auth-decision");
  });
  it("uses first heading at any level", () => {
    expect(deriveKey("### Tiny Heading\nBody")).toBe("tiny-heading");
  });
  it("falls back to first 8 words of content", () => {
    expect(deriveKey("we decided to pick clerk for auth tokens because")).toBe(
      "we-decided-to-pick-clerk-for-auth-tokens",
    );
  });
  it("falls back to 'note' if content is empty", () => {
    expect(deriveKey("")).toBe("note");
  });
});
