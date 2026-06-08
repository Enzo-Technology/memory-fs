// tests/eval/conditions.test.ts
import { describe, expect, it } from "vitest";
import { loadConditions, VERBS } from "../../eval/lib/conditions.mjs";

describe("conditions", () => {
  it("defines all six runnable surfaces with all seven verbs", () => {
    const conds = loadConditions();
    for (const id of ["M", "C", "K", "N", "MxC", "CxM"]) {
      expect(conds[id], `condition ${id}`).toBeTruthy();
      for (const verb of VERBS) {
        expect(conds[id].tools[verb]?.name, `${id}.${verb}.name`).toBeTruthy();
        expect(conds[id].tools[verb]?.description, `${id}.${verb}.desc`).toBeTruthy();
      }
      expect(conds[id].resultStrings.write, `${id}.resultStrings.write`).toBeTruthy();
    }
  });

  it("holds argument-bearing tool names to one noun prefix per condition", () => {
    const conds = loadConditions();
    expect(conds.M.tools.write.name).toBe("memory_write");
    expect(conds.C.tools.write.name).toBe("context_write");
    expect(conds.K.tools.write.name).toBe("knowledge_write");
    expect(conds.N.tools.write.name).toBe("store_write");
    expect(conds.MxC.tools.write.name).toBe("memory_write"); // memory names...
    expect(conds.MxC.tools.write.description).toBe(conds.C.tools.write.description); // ...context desc
    expect(conds.CxM.tools.write.name).toBe("context_write");
    expect(conds.CxM.tools.write.description).toBe(conds.M.tools.write.description);
  });

  it("keeps sibling descriptions within ±15% length (framing varies, not info content)", () => {
    const conds = loadConditions();
    const lens = ["M", "C", "K"].map((id) => conds[id].tools.write.description.length);
    const min = Math.min(...lens), max = Math.max(...lens);
    expect(max / min).toBeLessThan(1.15);
  });
});
