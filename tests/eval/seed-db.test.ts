// tests/eval/seed-db.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSeedDb } from "../../eval/fixtures/seed-db.mjs";
import { openDb } from "../../src/core/db.js";
import { MemoryStore } from "../../src/core/store.js";

describe("seed-db", () => {
  it("materializes all seed records into a fresh, queryable store", () => {
    const path = join(mkdtempSync(join(tmpdir(), "memfs-seed-")), "seed.db");
    buildSeedDb(path);
    const store = new MemoryStore(openDb(path));
    expect(store.read("project:enzo", "core-pain")?.content).toContain("2026-06-05");
    expect(store.read("project:enzo", "what-we-solve-for")?.content).toContain("desktop app");
    expect(store.recall({ query: "deploy" }).length).toBeGreaterThan(0);
  });
});
