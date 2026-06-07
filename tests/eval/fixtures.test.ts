// tests/eval/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const load = (p: string) => JSON.parse(readFileSync(resolve(__dirname, "../../eval/fixtures", p), "utf-8"));
const BANNED = /\b(memory|context|knowledge|notes?|the store|recall)\b|_(write|read|search|browse|link|backlinks|delete)\b/i;

function assertHistory(turns: any[]) {
  expect(Array.isArray(turns)).toBe(true);
  for (const t of turns) {
    expect(["user", "assistant"]).toContain(t.role);
    expect(typeof t.content).toBe("string"); // no tool blocks
    expect(t.content).not.toMatch(BANNED);
  }
}

describe("fabricated histories", () => {
  it("p3: long, no tool calls, no store vocabulary", () => {
    const h = load("p3-history.json");
    expect(h.length).toBeGreaterThanOrEqual(24);
    const chars = h.reduce((n: number, t: any) => n + t.content.length, 0);
    expect(chars).toBeGreaterThan(18000); // ~6k+ tokens
    assertHistory(h);
  });

  it("p3 manifest: exactly 2 durable / 1 reverted / 1 aside / 1 deferred", () => {
    const m = load("p3-manifest.json");
    const by = (k: string) => m.items.filter((i: any) => i.kind === k).length;
    expect(by("durable")).toBe(2);
    expect(by("reverted")).toBe(1);
    expect(by("aside")).toBe(1);
    expect(by("deferred")).toBe(1);
    expect(m.items.filter((i: any) => i.shouldFile).length).toBe(2);
  });
});
