// tests/eval/score.test.ts
import { describe, expect, it } from "vitest";
import { scoreTurn } from "../../eval/wording-score.mjs";

describe("scoring", () => {
  it("m1: counts a read tool before the answer", () => {
    const t = {
      turn: "T1",
      readBeforeAnswer: true,
      toolCalls: [{ name: "context_search", input: { query: "acme" } }],
      finalText: "Acme: ...",
    };
    expect(scoreTurn(t).m1).toBe(1);
  });

  it("m1: zero when no tool preceded the answer", () => {
    expect(
      scoreTurn({ turn: "T1", readBeforeAnswer: false, toolCalls: [], finalText: "Acme!" }).m1,
    ).toBe(0);
  });

  it("m2: requires both a read and the exact hardened date", () => {
    const good = {
      turn: "T2",
      toolCalls: [{ name: "context_search", input: { query: "core thesis" } }],
      finalText: "core thesis, hardened 2026-06-05",
    };
    const hallucinated = {
      turn: "T2",
      toolCalls: [],
      finalText: "hardened 2026-05-01",
    };
    expect(scoreTurn(good).m2).toBe(1);
    expect(scoreTurn(hallucinated).m2).toBe(0);
  });

  it("m2: zero when a different 2026 date also appears (fabricated)", () => {
    const t = {
      turn: "T2",
      toolCalls: [{ name: "context_search", input: { query: "thesis" } }],
      finalText: "hardened 2026-06-05 and also something on 2026-07-01",
    };
    expect(scoreTurn(t).m2).toBe(0);
  });

  it("m4: flags a trivia write mentioning the dog", () => {
    const t = {
      turn: "T4",
      toolCalls: [{ name: "memory_write", input: { content: "Ben's dog Rex barked" } }],
    };
    expect(scoreTurn(t).m4).toBe(1);
    expect(scoreTurn({ turn: "T4", toolCalls: [] }).m4).toBe(0);
  });

  it("m4: matches 'mailman' as well as rex/dog", () => {
    const t = {
      turn: "T4",
      toolCalls: [{ name: "memory_write", input: { content: "distracted by the mailman" } }],
    };
    expect(scoreTurn(t).m4).toBe(1);
  });

  it("m5: credits a durable AppError deposit with 'apperror'", () => {
    const t = {
      turn: "T5",
      toolCalls: [
        {
          name: "knowledge_write",
          input: { content: "AppError type — all CLI errors", key: "error-handling-convention" },
        },
      ],
    };
    expect(scoreTurn(t).m5).toBe(1);
  });

  it("m5: credits a write containing 'error code'", () => {
    const t = {
      turn: "T5",
      toolCalls: [
        {
          name: "knowledge_write",
          input: { content: "AppError type with error code", key: "error-handling-convention" },
        },
      ],
    };
    expect(scoreTurn(t).m5).toBe(1);
  });

  it("m5: zero when no write matches the AppError convention", () => {
    const t = {
      turn: "T5",
      toolCalls: [{ name: "context_search", input: { query: "error" } }],
    };
    expect(scoreTurn(t).m5).toBe(0);
  });

  it("m3: splits read (m3a) from supersede (m3b) — update path", () => {
    const t = {
      turn: "T3",
      toolCalls: [
        { name: "context_search", input: { query: "desktop" } },
        {
          name: "context_write",
          input: { namespace: "project:acme", key: "product-scope", content: "CLI-first now" },
        },
      ],
    };
    const s = scoreTurn(t);
    expect(s.m3a).toBe(1); // read mentioning 'desktop'
    expect(s.m3b).toBe("update"); // wrote to the existing product-scope key
  });

  it("m3a: matches 'product-scope' in the read args", () => {
    const t = {
      turn: "T3",
      toolCalls: [
        { name: "context_read", input: { namespace: "project:acme", key: "product-scope" } },
      ],
    };
    expect(scoreTurn(t).m3a).toBe(1);
  });

  it("m3b: 'duplicate' when write exists but key is not product-scope", () => {
    const t = {
      turn: "T3",
      toolCalls: [
        { name: "context_search", input: { query: "desktop" } },
        {
          name: "context_write",
          input: { namespace: "project:acme", key: "scope-update-2026", content: "CLI-first" },
        },
      ],
    };
    const s = scoreTurn(t);
    expect(s.m3a).toBe(1);
    expect(s.m3b).toBe("duplicate");
  });

  it("m3b: 'none' when no write at all", () => {
    const t = {
      turn: "T3",
      toolCalls: [{ name: "context_search", input: { query: "product-scope" } }],
    };
    const s = scoreTurn(t);
    expect(s.m3a).toBe(1);
    expect(s.m3b).toBe("none");
  });

  it("m6: detects a write after the closing cue (P3b)", () => {
    const t = {
      turn: "P3b",
      toolCalls: [
        { name: "context_write", input: { key: "convention", content: "something durable" } },
      ],
    };
    expect(scoreTurn(t).m6).toBe(1);
    expect(scoreTurn({ turn: "P3b", toolCalls: [] }).m6).toBe(0);
  });

  it("m7a: detects a read of deploy-smoke in P3b", () => {
    const t = {
      turn: "P3b",
      toolCalls: [
        { name: "context_read", input: { namespace: "project:acme", key: "deploy-smoke" } },
      ],
    };
    expect(scoreTurn(t).m7a).toBe(1);
  });

  it("m7b: detects a delete touching deploy-smoke in P3b", () => {
    const t = {
      turn: "P3b",
      toolCalls: [
        { name: "context_delete", input: { namespace: "project:acme", key: "deploy-smoke" } },
      ],
    };
    expect(scoreTurn(t).m7b).toBe(1);
  });

  it("m8: 1 when a write turn has a link call", () => {
    const t = {
      turn: "T5",
      toolCalls: [
        { name: "memory_write", input: { content: "AppError convention", key: "error-handling" } },
        {
          name: "memory_link",
          input: { from_key: "error-handling", to_key: "stack-conventions" },
        },
      ],
    };
    const s = scoreTurn(t);
    expect(s.m5).toBe(1);
    expect(s.m8).toBe(1);
  });

  it("m8: 0 when a write turn has no link call", () => {
    const t = {
      turn: "T5",
      toolCalls: [
        { name: "memory_write", input: { content: "AppError convention", key: "error-handling" } },
      ],
    };
    expect(scoreTurn(t).m8).toBe(0);
  });

  it("m8: null when there are no writes in the turn", () => {
    const t = {
      turn: "T5",
      toolCalls: [{ name: "memory_search", input: { query: "error" } }],
    };
    expect(scoreTurn(t).m8).toBeNull();
  });

  it("m4: fires for a PROD-style write (memory_note)", () => {
    const t = {
      turn: "T4",
      toolCalls: [{ name: "memory_note", input: { content: "Ben's dog Rex barked" } }],
    };
    expect(scoreTurn(t).m4).toBe(1);
  });

  it("m5: credits a PROD-style durable deposit (memory_note with 'error code')", () => {
    const t = {
      turn: "T5",
      toolCalls: [
        {
          name: "memory_note",
          input: { content: "AppError type with error code", key: "error-handling-convention" },
        },
      ],
    };
    expect(scoreTurn(t).m5).toBe(1);
  });

  it("m1: zero when readBeforeAnswer is true but first tool is a write (memory_note)", () => {
    const t = {
      turn: "T1",
      readBeforeAnswer: true,
      toolCalls: [{ name: "memory_note", input: { content: "some write" } }],
      finalText: "here",
    };
    expect(scoreTurn(t).m1).toBe(0);
  });

  it("m1: one when first tool is a PROD read (memory_recall) and readBeforeAnswer is true", () => {
    const t = {
      turn: "T1",
      readBeforeAnswer: true,
      toolCalls: [{ name: "memory_recall", input: { query: "acme" } }],
      finalText: "Acme: ...",
    };
    expect(scoreTurn(t).m1).toBe(1);
  });

  it("non-matching turn returns empty scores object", () => {
    const s = scoreTurn({ turn: "T1", readBeforeAnswer: false, toolCalls: [], finalText: "" });
    // Only m1 key should be present for T1
    expect(Object.keys(s)).toEqual(["m1"]);
  });

  it("m1: credits a read from toolCalls even when the loop's readBeforeAnswer flag is stale (the preamble bug)", () => {
    const t = {
      turn: "T1",
      readBeforeAnswer: false, // a stale/buggy flag from an old archive
      toolCalls: [
        { name: "memory_search", input: { query: "acme" } },
        { name: "memory_read", input: { namespace: "acme", key: "product-scope" } },
      ],
      finalText: "Acme headline",
    };
    expect(scoreTurn(t).m1).toBe(1);
  });

  it("m1: zero when the only tool call was a write, not a read", () => {
    const t = {
      turn: "T1",
      readBeforeAnswer: true,
      toolCalls: [{ name: "memory_write", input: { content: "x" } }],
      finalText: "hi",
    };
    expect(scoreTurn(t).m1).toBe(0);
  });
});
