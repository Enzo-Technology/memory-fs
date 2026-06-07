// tests/eval/judge-parse.test.ts
import { describe, expect, it } from "vitest";
import { extractWrittenRecords, blindRecord, cohenKappa } from "../../eval/wording-judge.mjs";

describe("judge helpers", () => {
  it("extracts write records from a run's transcripts", () => {
    const run = { transcripts: [
      { turn: "T5", toolCalls: [
        { name: "memory_write", input: { namespace: "project:enzo", key: "k", content: "EnzoError", type: "note", tags: ["x"] } },
        { name: "memory_search", input: { query: "z" } }] }] };
    const recs = extractWrittenRecords(run);
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe("k");
  });
  it("extractWrittenRecords pulls a memory_note record (PROD) as a write", () => {
    const run = { transcripts: [
      { turn: "T4", toolCalls: [
        { name: "memory_note", input: { key: "dog-trivia", content: "Rex barked at the mailman", type: "note", tags: [] } },
        { name: "memory_recall", input: { query: "rex" } }] }] };
    const recs = extractWrittenRecords(run);
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe("dog-trivia");
  });

  it("blinds a record to key/type/tags/body only", () => {
    const b = blindRecord({ namespace: "n", key: "k", content: "body", type: "note", tags: ["a"], extra: "leak" });
    expect(Object.keys(b).sort()).toEqual(["body", "key", "tags", "type"]);
  });
  it("computes Cohen's kappa for perfect agreement = 1", () => {
    expect(cohenKappa([1, 0, 1, 0], [1, 0, 1, 0])).toBeCloseTo(1, 5);
  });
});
