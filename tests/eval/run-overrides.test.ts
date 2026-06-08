// tests/eval/run-overrides.test.ts
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../eval/wording-run.mjs";

const base = { conditions: ["M", "C", "K"], models: ["sonnet"], scripts: ["P1", "P2"], n: 5 };

describe("applyOverrides", () => {
  it("returns the base matrix unchanged when there are no overrides", () => {
    expect(applyOverrides(base, ["node", "wording-run.mjs"])).toEqual(base);
  });

  it("narrows to a single 1-off cell", () => {
    const m = applyOverrides(base, ["node", "x", "--conditions=M", "--scripts=P1", "--models=sonnet", "--n=1"]);
    expect(m).toEqual({ conditions: ["M"], models: ["sonnet"], scripts: ["P1"], n: 1 });
  });

  it("parses --n as an integer", () => {
    expect(applyOverrides(base, ["--n=3"]).n).toBe(3);
  });

  it("splits comma-separated lists", () => {
    expect(applyOverrides(base, ["--conditions=M,C", "--models=sonnet,openai"]))
      .toMatchObject({ conditions: ["M", "C"], models: ["sonnet", "openai"] });
  });

  it("does not mutate the input matrix", () => {
    const copy = { ...base, conditions: [...base.conditions] };
    applyOverrides(base, ["--conditions=M"]);
    expect(base).toEqual(copy);
  });
});
