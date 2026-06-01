import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "memfs-"));
  return openDb(join(dir, "test.db"));
}

describe("schema", () => {
  it("has memories, links (new shape), tags, fts", () => {
    const db = fresh();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["links", "memories", "tags"]),
    );
    const linkCols = db.prepare("PRAGMA table_info(links)").all() as any[];
    const colNames = linkCols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      ["from_id", "relation", "source", "to_key", "to_namespace"].sort(),
    );
    const tagCols = (db.prepare("PRAGMA table_info(tags)").all() as any[])
      .map((c) => c.name)
      .sort();
    expect(tagCols).toEqual(["memory_id", "tag"]);
  });

  it("allows links to non-existent target keys (broken links permitted)", () => {
    const db = fresh();
    db.prepare(
      "INSERT INTO memories (namespace, key, type, content) VALUES (?,?,?,?)",
    ).run("ns", "src", "note", "body");
    const fromId = (db.prepare("SELECT id FROM memories").get() as any).id;
    expect(() =>
      db
        .prepare(
          "INSERT INTO links (from_id, to_namespace, to_key) VALUES (?,?,?)",
        )
        .run(fromId, "ns", "does-not-exist"),
    ).not.toThrow();
  });
});
