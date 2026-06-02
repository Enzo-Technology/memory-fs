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
  it("kind=index returns sections for recent/tags/namespaces", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "hub", content: "[[a]] [[b]]" });
    s.note({ namespace: "ns", key: "a", content: "x" });
    s.note({ namespace: "ns", key: "b", content: "y" });
    const r = s.browse({ kind: "index" });
    if (r.kind !== "index") throw new Error("expected index result");
    expect(r.total).toBe(3);
    expect(r.items.map((s) => s.section).sort()).toEqual([
      "namespaces",
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

// Fitness function for ADR 0002: every route that returns records carries a
// snippet; only the vocabulary views (tags, namespaces) return bare identifiers.
describe("snippet invariant", () => {
  it("recent / hubs / orphans / backlinks / near_duplicate all carry a snippet", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "hub", content: "Hub note\n\nsee [[ns:leaf]]" });
    s.note({ namespace: "ns", key: "leaf", content: "Leaf content first line" });
    const dup = s.note({ namespace: "ns", key: "leaf2", content: "Leaf content first line" });

    for (const kind of ["recent", "hubs", "orphans"] as const) {
      const r = s.browse({ kind });
      if (r.kind !== kind) throw new Error("kind");
      for (const it of r.items) expect(typeof it.snippet).toBe("string");
    }
    for (const b of s.backlinks("ns", "leaf")) expect(b.snippet.length).toBeGreaterThan(0);
    for (const d of dup.near_duplicate_warning ?? []) expect(typeof d.snippet).toBe("string");
  });
});

describe("normalization (#4)", () => {
  it("slugifies a provided key and namespace, and still resolves on read", () => {
    const s = freshStore();
    const m = s.note({ namespace: "Project:Web Stuff", key: "My Key!", content: "body" });
    expect(m.namespace).toBe("project:web-stuff");
    expect(m.key).toBe("my-key");
    expect(s.read("PROJECT:Web Stuff", "my key!")?.key).toBe("my-key");
  });
  it("normalizes wikilink targets so links resolve to normalized records", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "src", content: "see [[NS:My Target]]" });
    s.note({ namespace: "ns", key: "my-target", content: "target" });
    expect(s.backlinks("ns", "my-target").map((b) => b.from_key)).toContain("src");
  });
});

describe("read neighbourhood (chunk 5)", () => {
  it("returns children (outbound) and backlinks (inbound) with snippets", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "hub", content: "hub\n[[ns:child]]" });
    s.note({ namespace: "ns", key: "child", content: "child body\n[[ns:hub]]" });
    const r = s.read("ns", "hub");
    expect(r?.children.map((c) => c.key)).toContain("child");
    expect(r?.backlinks.map((b) => b.key)).toContain("child");
    expect(r?.children[0]!.snippet.length).toBeGreaterThan(0);
  });
  it("omits dangling outbound links (no such record)", () => {
    const s = freshStore();
    s.note({ namespace: "ns", key: "hub", content: "[[ns:missing]]" });
    expect(s.read("ns", "hub")?.children.length).toBe(0);
  });
});

describe("size_warning (chunk 6)", () => {
  it("warns on long non-reference, silent for reference and short notes", () => {
    const s = freshStore();
    const long = Array(250).fill("word").join(" ");
    expect(s.note({ namespace: "ns", key: "big", content: long }).size_warning).toBeDefined();
    expect(
      s.note({ namespace: "ns", key: "ref", type: "reference", content: long }).size_warning,
    ).toBeUndefined();
    expect(s.note({ namespace: "ns", key: "small", content: "short" }).size_warning).toBeUndefined();
  });
});

describe("browse namespaces", () => {
  it("returns namespace vocabulary with counts, filterable by prefix", () => {
    const s = freshStore();
    s.note({ namespace: "voice:founder", key: "a", content: "x" });
    s.note({ namespace: "voice:founder", key: "b", content: "y" });
    s.note({ namespace: "project:web", key: "c", content: "z" });
    const all = s.browse({ kind: "namespaces" });
    if (all.kind !== "namespaces") throw new Error("kind");
    const counts = Object.fromEntries(all.items.map((i) => [i.namespace, i.count]));
    expect(counts["voice:founder"]).toBe(2);
    expect(counts["project:web"]).toBe(1);

    const filtered = s.browse({ kind: "namespaces", prefix: "voice:" });
    if (filtered.kind !== "namespaces") throw new Error("kind");
    expect(filtered.items.map((i) => i.namespace)).toEqual(["voice:founder"]);
  });
});
