// eval/fixtures/seed-db.mjs — build a fresh seeded SQLite file. Copy-free: the
// harness calls this per iteration with a unique path, so every run starts clean.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../../dist/core/db.js";
import { MemoryStore } from "../../dist/core/store.js";

const records = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "seed-records.json"), "utf-8"),
);

export function buildSeedDb(path) {
  const store = new MemoryStore(openDb(path));
  for (const r of records) {
    store.note({ namespace: r.namespace, key: r.key, type: r.type, tags: r.tags, content: r.content }, "seed");
  }
  return path;
}
