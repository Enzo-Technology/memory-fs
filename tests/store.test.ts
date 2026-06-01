import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db.js";
import { MemoryStore } from "../src/core/store.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "memfs-"));
  return new MemoryStore(openDb(join(dir, "test.db")));
}

describe("MemoryStore.note", () => {
  it("derives key from first heading when key absent", () => {
    const s = freshStore();
    const m = s.note({ namespace: "ns", content: "# Auth Decision\n\nbody" });
    expect(m.key).toBe("auth-decision");
  });

  it("auto-extracts [[wikilinks]] into the links table", () => {
    const s = freshStore();
    const m = s.note({
      namespace: "project:enzo",
      key: "src",
      content: "see [[auth-decision]] and [[other:thing]]",
    });
    const links = s.backlinks("project:enzo", "auth-decision");
    expect(links.length).toBe(1);
    expect(links[0]!.from_namespace).toBe("project:enzo");
    expect(links[0]!.from_key).toBe("src");
  });

  it("persists tags into the tags table", () => {
    const s = freshStore();
    s.note({
      namespace: "ns",
      key: "a",
      content: "x",
      tags: ["decision", "auth"],
    });
    const r = s.browse({ kind: "tags" });
    if (r.kind !== "tags") throw new Error("expected tags result");
    expect(r.items.map((t) => t.tag).sort()).toEqual(["auth", "decision"]);
  });

  it("preserves existing tags when append with no tags arg", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "a", content: "first", tags: ["keep-me"] });
    s.note({ namespace: "ns", key: "a", content: "more", on_conflict: "append" });
    const r = s.browse({ kind: "tags" });
    if (r.kind !== "tags") throw new Error("expected tags result");
    expect(r.items.map((t) => t.tag)).toContain("keep-me");
  });

  it("returns near_duplicate_warning when a similar record exists", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "a", content: "the auth rewrite proposal" });
    const r = s.note({
      namespace: "ns",
      key: "b",
      content: "the auth rewrite proposal again",
    });
    expect(r.near_duplicate_warning?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("MemoryStore.recall", () => {
  it("returns full records ranked by FTS bm25", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "a", content: "auth rewrite proposal" });
    s.note({ namespace: "ns", key: "b", content: "unrelated content" });
    const r = s.recall({ query: "auth" });
    expect(r[0]!.key).toBe("a");
    expect(r[0]!.content).toContain("auth");
  });

  it("filters by namespace", () => {
    const s = freshStore();
    s.note({ namespace: "x", key: "a", content: "auth" });
    s.note({ namespace: "y", key: "b", content: "auth" });
    const r = s.recall({ query: "auth", namespace: "x" });
    expect(r.map((m) => m.namespace)).toEqual(["x"]);
  });
});

describe("MemoryStore.browse", () => {
  it("kind=index returns sections for recent/hubs/tags", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "hub", content: "[[a]] [[b]]" });
    s.note({ namespace: "ns", key: "a", content: "x" });
    s.note({ namespace: "ns", key: "b", content: "y" });
    const r = s.browse({ kind: "index" });
    if (r.kind !== "index") throw new Error("expected index result");
    expect(r.total).toBe(3);
    expect(r.items.map((s) => s.section).sort()).toEqual([
      "hubs",
      "recent",
      "tags",
    ]);
  });

  it("kind=hubs ranks by in-degree", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "a", content: "x" });
    s.note({ namespace: "ns", key: "src1", content: "[[a]]" });
    s.note({ namespace: "ns", key: "src2", content: "[[a]]" });
    const r = s.browse({ kind: "hubs" });
    if (r.kind !== "hubs") throw new Error("expected hubs result");
    expect(r.items[0]!.key).toBe("a");
    expect(r.items[0]!.in_degree).toBe(2);
  });

  it("kind=orphans finds records with no links in or out", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "lone", content: "no refs" });
    s.note({ namespace: "ns", key: "src", content: "[[target]]" });
    const r = s.browse({ kind: "orphans" });
    if (r.kind !== "orphans") throw new Error("expected orphans result");
    const keys = r.items.map((x) => x.key);
    expect(keys).toContain("lone");
    expect(keys).not.toContain("src");
  });
});

describe("MemoryStore.del", () => {
  it("refuses delete when backlinks exist unless force=true", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "target", content: "x" });
    s.note({ namespace: "ns", key: "src", content: "[[target]]" });
    expect(() => s.del("ns", "target")).toThrow(/backlinks/);
    expect(s.del("ns", "target", true)).toBe(true);
  });
});

describe("MemoryStore.backlinks", () => {
  it("returns inbound records", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "target", content: "x" });
    s.note({ namespace: "ns", key: "src", content: "see [[target]]" });
    const bl = s.backlinks("ns", "target");
    expect(bl.length).toBe(1);
    expect(bl[0]!.from_key).toBe("src");
  });
});
