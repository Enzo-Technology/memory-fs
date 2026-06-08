// tests/eval/analysis.test.ts
import { describe, expect, it } from "vitest";
import { wilson, riskDifference } from "../../eval/analysis.mjs";

describe("analysis", () => {
  it("wilson CI brackets the point estimate", () => {
    const { lo, hi, p } = wilson(10, 20);
    expect(p).toBeCloseTo(0.5, 5);
    expect(lo).toBeGreaterThan(0.27); expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5); expect(hi).toBeLessThan(0.73);
  });
  it("risk difference reports the gap with a CI", () => {
    const rd = riskDifference({ x: 18, n: 20 }, { x: 6, n: 20 }); // M vs C on m4
    expect(rd.diff).toBeCloseTo(0.6, 5);
    expect(rd.lo).toBeLessThan(0.6); expect(rd.hi).toBeGreaterThan(0.6);
  });
});
