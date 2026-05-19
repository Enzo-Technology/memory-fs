# memory-fs Phase 1: Wiki Layer + Tool Surface Collapse + MCPJam Eval

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor memory-fs from 9 tools to 7 (`memory_note`, `memory_recall`, `memory_browse` + 4 specialists), add wiki-layer hypertext features (`[[wikilink]]` auto-extraction into a links table, separate tags table with vocabulary, hub/orphan computation, backlinks-as-tool), then validate the design with a 750-call MCPJam evaluation against Claude Haiku 4.5 across 3 system-prompt variants × 2 tool-regime conditions.

**Architecture:** SQLite + FTS5 stays as the substrate. Schema additions: a normalized `tags` table for vocabulary queries (the JSON `tags` column stays on `memories` as a denormalized cache); the existing `links` table is replaced with a new shape that supports unresolved targets `(from_id, to_namespace, to_key, relation, source)` so broken `[[wikilinks]]` are first-class. Auto-extraction of `[[ns:key]]` and `[[key]]` syntax runs in `MemoryStore.note()`. The server's tool surface collapses to 3 front-door tools (note/recall/browse) plus 4 specialists (read/delete/link/backlinks). The eval harness is a small set of versioned JSON files plus a runbook for driving MCPJam Inspector against the local stdio server.

**Tech Stack:** Node.js 22, TypeScript ES2022 modules, `better-sqlite3`, `@modelcontextprotocol/sdk`, `zod`, plus new dev dep `vitest`. Evaluation rig: [MCPJam Inspector](https://github.com/MCPJam/inspector) via `npx @mcpjam/inspector`.

**Out of scope (deferred):** Embeddings + hybrid vector search (Phase 2). Semantic dedup-on-write via LLM judge (Phase 3). Temporal validity columns (Phase 3). `memory_reflect` tool (Phase 4). Letta-style pinned context blocks (Phase 4). Multi-tenant ACLs (auth = boolean in or out). HTTP transport + Fly deploy (Phase 5).

---

## File structure

**Modify:**
- `src/db.ts` — replace `links` table DDL, add `tags` table, drop `idx_memories_updated` rebuild only if needed
- `src/store.ts` — replace `write/read/search/list/link/linksOf/namespaces` with `note/recall/browse/read/del/link/backlinks/wikilinkTargets`. Internal helpers: `parseWikilinks`, `extractTags`, `applyTags`, `applyLinks`, `inDegrees`, `hubs`, `orphans`, `tagVocabulary`
- `src/server.ts` — remove 9 tool registrations, register 7 new ones with revised descriptions
- `package.json` — add `vitest` dev dep, add `"test"` script

**Create:**
- `src/slug.ts` — slug utility for auto-key generation
- `src/wikilinks.ts` — `[[ns:key]]` / `[[key]]` parser
- `src/types.ts` — shared interfaces (extract `Memory`, `MemoryType`, input/result shapes from db.ts and store.ts)
- `vitest.config.ts` — node target, single-thread (better-sqlite3 isn't pooled)
- `tests/slug.test.ts` — unit
- `tests/wikilinks.test.ts` — unit
- `tests/store.test.ts` — unit (writes per-test sqlite into tmpdir)
- `tests/server.smoke.test.ts` — spawns `dist/server.js` over stdio, runs an MCP round-trip
- `eval/prompts.json` — 25 test prompts × 5 categories
- `eval/system-prompts/A-minimal.md` — variant A
- `eval/system-prompts/B-usage-hints.md` — variant B (predicted winner)
- `eval/system-prompts/C-meta-instruction.md` — variant C
- `eval/README.md` — how to run, MCPJam setup, regime config
- `eval/scoring-rubric.md` — manual scoring template
- `eval/results/.gitkeep`

---

## Schema details (locked in)

**`memories` table — unchanged** (keep current DDL).

**`links` table — drop and recreate** (single-user pre-production data, no migration cost):

```sql
CREATE TABLE IF NOT EXISTS links (
  from_id        INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_namespace   TEXT NOT NULL,
  to_key         TEXT NOT NULL,
  relation       TEXT NOT NULL DEFAULT 'wikilink',
  source         TEXT NOT NULL DEFAULT 'auto'
                 CHECK (source IN ('auto', 'manual')),
  PRIMARY KEY (from_id, to_namespace, to_key, relation)
);

CREATE INDEX IF NOT EXISTS idx_links_target
  ON links(to_namespace, to_key);
```

Rationale: agents write `[[project:enzo/auth-decision]]` even when the target doesn't exist yet — broken links are wiki-native and resolved by JOIN at read time.

**`tags` table — new**:

```sql
CREATE TABLE IF NOT EXISTS tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
```

The JSON `tags` column on `memories` stays as a denormalized cache so `Memory.tags` reads remain a single-row fetch.

---

## Tool surface (locked in)

| Tool | Description angle | Required args | Optional args |
|---|---|---|---|
| `memory_note` | Write/upsert a memory; auto-extracts `[[wikilinks]]` and detects near-duplicates | `content` | `namespace`, `key`, `type`, `tags`, `on_conflict` |
| `memory_recall` | Search and return full matching records, hub-first, dedup-collapsed | `query` | `namespace`, `type`, `tags`, `limit`, `since` |
| `memory_browse` | Discovery: index/recent/hubs/orphans/tags | `kind` (enum) | `namespace`, `prefix`, `limit` |
| `memory_read` | Exact fetch by (namespace, key) | `namespace`, `key` | — |
| `memory_delete` | Permanent delete; refuses if backlinks exist unless `force` | `namespace`, `key` | `force` |
| `memory_link` | Manually assert a link (most links come from auto-extracted `[[wikilinks]]`) | `from_namespace`, `from_key`, `to_namespace`, `to_key` | `relation` |
| `memory_backlinks` | Return records that link *to* this one | `namespace`, `key` | — |

---

## Tasks

### Task 1: Add vitest as dev dependency

**Files:**
- Modify: `/Users/ben/Documents/Projects/code/memory-fs/package.json`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
cd /Users/ben/Documents/Projects/code/memory-fs && npm install -D vitest@^2.1.0
```

- [ ] **Step 2: Create vitest config**

Write `/Users/ben/Documents/Projects/code/memory-fs/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 3: Add test script**

Edit `package.json` `"scripts"` block — add `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Verify empty test discovery works**

Run: `npm test`
Expected: `No test files found, exiting with code 0` is acceptable for vitest 2.x with `--passWithNoTests`. If exit code is 1, add `passWithNoTests: true` to the config and re-run; expected exit 0.

- [ ] **Step 5: Commit**

```bash
git init -q 2>/dev/null; git add package.json package-lock.json vitest.config.ts; git commit -m "chore: add vitest"
```

---

### Task 2: Slug utility

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/src/slug.ts`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/tests/slug.test.ts`

- [ ] **Step 1: Write failing tests**

Write `/Users/ben/Documents/Projects/code/memory-fs/tests/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify, deriveKey } from "../src/slug.js";

describe("slugify", () => {
  it("lowercases and kebabs", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
  it("collapses repeated separators", () => {
    expect(slugify("foo - bar  baz")).toBe("foo-bar-baz");
  });
  it("strips non-alphanumerics except dash", () => {
    expect(slugify("auth_rewrite (v2)")).toBe("auth-rewrite-v2");
  });
  it("truncates to 60 chars on a word boundary", () => {
    const long = "a".repeat(70) + " end";
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
  it("empties fall back to 'note'", () => {
    expect(slugify("!!!")).toBe("note");
    expect(slugify("")).toBe("note");
  });
});

describe("deriveKey", () => {
  it("uses first h1", () => {
    expect(deriveKey("# Auth Decision\n\nBody")).toBe("auth-decision");
  });
  it("uses first heading at any level", () => {
    expect(deriveKey("### Tiny Heading\nBody")).toBe("tiny-heading");
  });
  it("falls back to first 8 words of content", () => {
    expect(deriveKey("we decided to pick clerk for auth tokens because")).toBe(
      "we-decided-to-pick-clerk-for-auth-tokens",
    );
  });
  it("falls back to 'note' if content is empty", () => {
    expect(deriveKey("")).toBe("note");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- slug`
Expected: FAIL ("Cannot find module '../src/slug.js'")

- [ ] **Step 3: Implement**

Write `/Users/ben/Documents/Projects/code/memory-fs/src/slug.ts`:

```ts
const MAX = 60;

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "note";
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 20 ? cut.slice(0, lastDash) : cut;
}

export function deriveKey(content: string): string {
  const heading = content.match(/^#+\s+(.+)$/m);
  if (heading) return slugify(heading[1]!);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  const firstWords = firstLine.split(/\s+/).slice(0, 8).join(" ");
  return slugify(firstWords);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- slug`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/slug.ts tests/slug.test.ts && git commit -m "feat: slug + deriveKey utility"
```

---

### Task 3: Wikilink parser

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/src/wikilinks.ts`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/tests/wikilinks.test.ts`

- [ ] **Step 1: Write failing tests**

Write `/Users/ben/Documents/Projects/code/memory-fs/tests/wikilinks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWikilinks, type WikilinkRef } from "../src/wikilinks.js";

describe("parseWikilinks", () => {
  const ofNs = "project:enzo";

  it("extracts ns:key form", () => {
    expect(parseWikilinks("see [[project:enzo/auth-decision]]", ofNs)).toEqual<
      WikilinkRef[]
    >([{ namespace: "project:enzo", key: "auth-decision" }]);
  });
  it("treats bare keys as same-namespace", () => {
    expect(parseWikilinks("ref [[notes/a]] and [[notes/b]]", ofNs)).toEqual<
      WikilinkRef[]
    >([
      { namespace: ofNs, key: "notes/a" },
      { namespace: ofNs, key: "notes/b" },
    ]);
  });
  it("dedups identical refs", () => {
    expect(parseWikilinks("[[x]] and [[x]] again", ofNs)).toHaveLength(1);
  });
  it("ignores empty brackets and unclosed", () => {
    expect(parseWikilinks("oops [[]] and [[unclosed", ofNs)).toEqual([]);
  });
  it("ignores triple-bracket (escape) form", () => {
    expect(parseWikilinks("literal [[[notwiki]]]", ofNs)).toEqual([]);
  });
  it("ignores code blocks and inline code", () => {
    const md =
      "before ```\n[[ignored]]\n``` after [[real]] also `[[inline]]`";
    expect(parseWikilinks(md, ofNs)).toEqual([
      { namespace: ofNs, key: "real" },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- wikilinks`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement**

Write `/Users/ben/Documents/Projects/code/memory-fs/src/wikilinks.ts`:

```ts
export interface WikilinkRef {
  namespace: string;
  key: string;
}

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const TRIPLE = /\[\[\[[^\]]*\]\]\]/g;
const LINK = /\[\[([^\[\]\n]+?)\]\]/g;

export function parseWikilinks(
  content: string,
  defaultNamespace: string,
): WikilinkRef[] {
  const stripped = content
    .replace(FENCE, "")
    .replace(INLINE_CODE, "")
    .replace(TRIPLE, "");
  const seen = new Set<string>();
  const out: WikilinkRef[] = [];
  for (const match of stripped.matchAll(LINK)) {
    const raw = match[1]!.trim();
    if (!raw) continue;
    const colon = raw.indexOf(":");
    const slash = raw.indexOf("/");
    let namespace: string;
    let key: string;
    if (colon !== -1 && (slash === -1 || colon < slash)) {
      const cut = raw.indexOf("/", colon);
      if (cut === -1) {
        namespace = raw.slice(0, colon);
        key = raw.slice(colon + 1);
      } else {
        namespace = raw.slice(0, cut);
        key = raw.slice(cut + 1);
      }
    } else {
      namespace = defaultNamespace;
      key = raw;
    }
    namespace = namespace.trim();
    key = key.trim();
    if (!namespace || !key) continue;
    const sig = `${namespace}\x00${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ namespace, key });
  }
  return out;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- wikilinks`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/wikilinks.ts tests/wikilinks.test.ts && git commit -m "feat: [[wikilink]] parser"
```

---

### Task 4: Schema migration — new links + tags tables

**Files:**
- Modify: `/Users/ben/Documents/Projects/code/memory-fs/src/db.ts`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/tests/db.test.ts`

- [ ] **Step 1: Write failing tests**

Write `/Users/ben/Documents/Projects/code/memory-fs/tests/db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";

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
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- db`
Expected: FAIL — current `links` table uses `to_id` (FK), not `to_namespace`/`to_key`.

- [ ] **Step 3: Update schema in `src/db.ts`**

In `migrate()`, replace the `CREATE TABLE IF NOT EXISTS links (...)` block with the DROP + CREATE below. The DROP is required because the old `links` schema is incompatible (`to_id` FK vs the new `to_namespace, to_key` shape); `CREATE TABLE IF NOT EXISTS` alone would silently keep the old schema and the new code would fail at runtime.

```sql
DROP TABLE IF EXISTS links;

CREATE TABLE IF NOT EXISTS links (
  from_id        INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_namespace   TEXT NOT NULL,
  to_key         TEXT NOT NULL,
  relation       TEXT NOT NULL DEFAULT 'wikilink',
  source         TEXT NOT NULL DEFAULT 'auto'
                 CHECK (source IN ('auto', 'manual')),
  PRIMARY KEY (from_id, to_namespace, to_key, relation)
);

CREATE INDEX IF NOT EXISTS idx_links_target ON links(to_namespace, to_key);

CREATE TABLE IF NOT EXISTS tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
```

(Append the two new tables after the existing trigger block. **Delete the old `links` table DDL.**)

- [ ] **Step 4: Drop existing dev DB so schema rebuilds cleanly**

```bash
rm -f /tmp/memfs-*.db* ~/.memory-fs/memory.db ~/.memory-fs/memory.db-wal ~/.memory-fs/memory.db-shm
```

- [ ] **Step 5: Run, expect pass**

Run: `npm test -- db`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/db.ts tests/db.test.ts && git commit -m "feat: schema for [[wikilinks]] and tag vocabulary"
```

---

### Task 5: MemoryStore — refactor to new method surface

This task replaces nearly all of `store.ts`. Done as one task because the methods are tightly coupled (note writes links and tags transactionally; recall and browse depend on those tables).

**Files:**
- Replace: `/Users/ben/Documents/Projects/code/memory-fs/src/store.ts`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/tests/store.test.ts`

- [ ] **Step 1: Write failing tests**

Write `/Users/ben/Documents/Projects/code/memory-fs/tests/store.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { MemoryStore } from "../src/store.js";

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
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- store`
Expected: FAIL — methods `note`, `recall`, `browse`, `del`, `backlinks` don't exist yet.

- [ ] **Step 3: Implement `src/store.ts`** (full replacement)

Replace the entire contents of `/Users/ben/Documents/Projects/code/memory-fs/src/store.ts` with:

```ts
import type Database from "better-sqlite3";
import {
  type Memory,
  type MemoryRow,
  type MemoryType,
  rowToMemory,
} from "./db.js";
import { deriveKey } from "./slug.js";
import { parseWikilinks } from "./wikilinks.js";

export type OnConflict = "overwrite" | "append" | "error";
export type BrowseKind = "index" | "recent" | "hubs" | "orphans" | "tags";

export interface NoteInput {
  namespace: string;
  content: string;
  key?: string;
  type?: MemoryType;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  on_conflict?: OnConflict;
}

export interface NearDuplicate {
  namespace: string;
  key: string;
  score: number;
}

export interface NoteResult extends Memory {
  near_duplicate_warning?: NearDuplicate[];
}

export interface RecallInput {
  query: string;
  namespace?: string;
  type?: MemoryType;
  tags?: string[];
  limit?: number;
  since?: string;
}

export interface BrowseInput {
  kind: BrowseKind;
  namespace?: string;
  prefix?: string;
  limit?: number;
}

export interface RecentItem {
  namespace: string;
  key: string;
  type: MemoryType;
  updated_at: string;
}
export interface HubItem extends RecentItem {
  in_degree: number;
}
export interface OrphanItem extends RecentItem {}
export interface TagItem {
  tag: string;
  count: number;
}
export interface IndexSection {
  section: "recent" | "hubs" | "tags";
  items: RecentItem[] | HubItem[] | TagItem[];
}

export type BrowseResult =
  | { kind: "index"; total: number; items: IndexSection[] }
  | { kind: "recent"; total: number; items: RecentItem[] }
  | { kind: "hubs"; total: number; items: HubItem[] }
  | { kind: "orphans"; total: number; items: OrphanItem[] }
  | { kind: "tags"; total: number; items: TagItem[] };

export interface Backlink {
  from_namespace: string;
  from_key: string;
  relation: string;
  source: "auto" | "manual";
}

const DUP_SIM_THRESHOLD = -2; // bm25 is negative; closer to 0 = more relevant

export class MemoryStore {
  constructor(private db: Database.Database) {}

  // ---------- write ----------

  note(input: NoteInput): NoteResult {
    const namespace = input.namespace;
    const key = input.key ?? deriveKey(input.content);
    const onConflict: OnConflict = input.on_conflict ?? "overwrite";

    const existing = this.db
      .prepare<unknown[], MemoryRow>(
        `SELECT * FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(namespace, key);

    if (existing && onConflict === "error") {
      throw new Error(
        `memory exists at namespace='${namespace}' key='${key}'. ` +
          `Pass on_conflict='overwrite' or 'append'.`,
      );
    }

    // Dup check runs BEFORE upsert, against the original input, so the just-
    // written record can't self-match through FTS.
    const dup = this.findNearDuplicates(
      namespace,
      key,
      input.content,
      existing?.id ?? null,
    );

    const content =
      existing && onConflict === "append"
        ? `${existing.content}\n\n${input.content}`
        : input.content;

    // If caller omitted tags entirely on an append, preserve existing tags
    // rather than silently dropping them.
    const tagsForRow =
      input.tags ?? (existing ? (JSON.parse(existing.tags) as string[]) : []);
    const tagsJson = JSON.stringify(tagsForRow);
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const type = input.type ?? "note";

    const upsert = this.db.transaction((): MemoryRow => {
      const row = this.db
        .prepare<unknown[], MemoryRow>(
          `INSERT INTO memories (namespace, key, type, content, tags, metadata, source)
           VALUES (@namespace, @key, @type, @content, @tags, @metadata, @source)
           ON CONFLICT(namespace, key) DO UPDATE SET
             type        = excluded.type,
             content     = excluded.content,
             tags        = excluded.tags,
             metadata    = excluded.metadata,
             source      = excluded.source,
             updated_at  = datetime('now'),
             accessed_at = datetime('now')
           RETURNING *`,
        )
        .get({
          namespace,
          key,
          type,
          content,
          tags: tagsJson,
          metadata: metadataJson,
          source: input.source ?? null,
        });
      if (!row) throw new Error("note: upsert failed");
      if (input.tags !== undefined) this.applyTags(row.id, input.tags);
      this.applyAutoLinks(row.id, namespace, content);
      return row;
    });

    const row = upsert();
    const result: NoteResult = rowToMemory(row);
    if (dup.length) result.near_duplicate_warning = dup;
    return result;
  }

  private applyTags(memoryId: number, tags: string[]): void {
    this.db.prepare(`DELETE FROM tags WHERE memory_id = ?`).run(memoryId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO tags (memory_id, tag) VALUES (?, ?)`,
    );
    for (const tag of tags) insert.run(memoryId, tag);
  }

  private applyAutoLinks(
    memoryId: number,
    sourceNamespace: string,
    content: string,
  ): void {
    this.db
      .prepare(`DELETE FROM links WHERE from_id = ? AND source = 'auto'`)
      .run(memoryId);
    const refs = parseWikilinks(content, sourceNamespace);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO links
       (from_id, to_namespace, to_key, relation, source)
       VALUES (?, ?, ?, 'wikilink', 'auto')`,
    );
    for (const r of refs) insert.run(memoryId, r.namespace, r.key);
  }

  private findNearDuplicates(
    namespace: string,
    key: string,
    content: string,
    excludeId: number | null,
  ): NearDuplicate[] {
    const term = content.slice(0, 200).replace(/[^\w\s]+/g, " ").trim();
    if (!term) return [];
    const rows = this.db
      .prepare<
        unknown[],
        { namespace: string; key: string; rank: number }
      >(
        `SELECT m.namespace, m.key, bm25(memories_fts) AS rank
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH @q
           AND NOT (m.namespace = @ns AND m.key = @k)
           AND (@excludeId IS NULL OR m.id != @excludeId)
         ORDER BY rank
         LIMIT 3`,
      )
      .all({
        q: this.ftsQuery(term),
        ns: namespace,
        k: key,
        excludeId,
      });
    return rows
      .filter((r) => r.rank < DUP_SIM_THRESHOLD)
      .map((r) => ({ namespace: r.namespace, key: r.key, score: -r.rank }));
  }

  private ftsQuery(raw: string): string {
    return raw
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .map((w) => `"${w.replace(/"/g, "")}"`)
      .join(" OR ") || `"${raw}"`;
  }

  // ---------- read ----------

  read(namespace: string, key: string): Memory | null {
    const row = this.db
      .prepare<unknown[], MemoryRow>(
        `UPDATE memories SET accessed_at = datetime('now')
         WHERE namespace = ? AND key = ?
         RETURNING *`,
      )
      .get(namespace, key);
    return row ? rowToMemory(row) : null;
  }

  // ---------- search ----------

  recall(input: RecallInput): Memory[] {
    const where: string[] = ["memories_fts MATCH @query"];
    const params: Record<string, unknown> = { query: input.query };
    if (input.namespace) {
      where.push("m.namespace = @namespace");
      params.namespace = input.namespace;
    }
    if (input.type) {
      where.push("m.type = @type");
      params.type = input.type;
    }
    if (input.since) {
      where.push("m.updated_at >= @since");
      params.since = input.since;
    }
    for (const [i, tag] of (input.tags ?? []).entries()) {
      const p = `tag${i}`;
      where.push(`EXISTS (SELECT 1 FROM tags t WHERE t.memory_id = m.id AND t.tag = @${p})`);
      params[p] = tag;
    }
    params.limit = input.limit ?? 5;
    const rows = this.db
      .prepare<unknown[], MemoryRow & { has_inbound: 0 | 1 }>(
        `SELECT m.*,
                EXISTS (SELECT 1 FROM links l
                         WHERE l.to_namespace = m.namespace
                           AND l.to_key = m.key) AS has_inbound
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE ${where.join(" AND ")}
         ORDER BY has_inbound DESC, bm25(memories_fts)
         LIMIT @limit`,
      )
      .all(params);
    return rows.map(rowToMemory);
  }

  // ---------- discovery ----------

  browse(input: BrowseInput): BrowseResult {
    const limit = input.limit ?? 20;
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }
    ).c;
    switch (input.kind) {
      case "recent":
        return {
          kind: "recent",
          total,
          items: this.recent(limit, input.namespace, input.prefix),
        };
      case "hubs":
        return { kind: "hubs", total, items: this.hubs(limit, input.namespace) };
      case "orphans":
        return {
          kind: "orphans",
          total,
          items: this.orphans(limit, input.namespace),
        };
      case "tags":
        return { kind: "tags", total, items: this.tagVocabulary(input.prefix, limit) };
      case "index":
      default: {
        const sections: IndexSection[] = [
          {
            section: "recent",
            items: this.recent(5, input.namespace, input.prefix),
          },
          { section: "hubs", items: this.hubs(5, input.namespace) },
          { section: "tags", items: this.tagVocabulary(input.prefix, 10) },
        ];
        return { kind: "index", total, items: sections };
      }
    }
  }

  private recent(limit: number, namespace?: string, prefix?: string): RecentItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (namespace) {
      where.push("namespace = @namespace");
      params.namespace = namespace;
    }
    if (prefix) {
      where.push("key LIKE @prefix");
      params.prefix = `${prefix}%`;
    }
    const sql =
      `SELECT namespace, key, type, updated_at FROM memories` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY updated_at DESC LIMIT @limit`;
    return this.db.prepare<unknown[], RecentItem>(sql).all(params);
  }

  private hubs(limit: number, namespace?: string): HubItem[] {
    const where = namespace ? "WHERE m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    return this.db
      .prepare<unknown[], HubItem>(
        `SELECT m.namespace, m.key, m.type, m.updated_at,
                COALESCE(agg.in_degree, 0) AS in_degree
         FROM memories m
         LEFT JOIN (
           SELECT to_namespace, to_key, COUNT(*) AS in_degree
           FROM links
           GROUP BY to_namespace, to_key
         ) agg
           ON agg.to_namespace = m.namespace AND agg.to_key = m.key
         ${where}
         ORDER BY in_degree DESC, m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params);
  }

  private orphans(limit: number, namespace?: string): OrphanItem[] {
    const where = namespace ? "AND m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    return this.db
      .prepare<unknown[], OrphanItem>(
        `SELECT m.namespace, m.key, m.type, m.updated_at FROM memories m
         WHERE NOT EXISTS (SELECT 1 FROM links lo WHERE lo.from_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM links li
                            WHERE li.to_namespace = m.namespace
                              AND li.to_key = m.key)
           ${where}
         ORDER BY m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params);
  }

  private tagVocabulary(prefix: string | undefined, limit: number): TagItem[] {
    const where = prefix ? "WHERE tag LIKE @prefix" : "";
    const params: Record<string, unknown> = { limit };
    if (prefix) params.prefix = `${prefix}%`;
    return this.db
      .prepare<unknown[], TagItem>(
        `SELECT tag, COUNT(*) AS count FROM tags
         ${where}
         GROUP BY tag
         ORDER BY count DESC, tag ASC
         LIMIT @limit`,
      )
      .all(params);
  }

  // ---------- delete ----------

  del(namespace: string, key: string, force = false): boolean {
    const row = this.db
      .prepare<unknown[], { id: number }>(
        `SELECT id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(namespace, key);
    if (!row) return false;
    const backlinkCount = (
      this.db
        .prepare<unknown[], { c: number }>(
          `SELECT COUNT(*) AS c FROM links WHERE to_namespace = ? AND to_key = ?`,
        )
        .get(namespace, key) as { c: number }
    ).c;
    if (backlinkCount > 0 && !force) {
      throw new Error(
        `cannot delete ${namespace}/${key}: ${backlinkCount} backlinks exist. Pass force=true to delete anyway.`,
      );
    }
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(row.id);
    return true;
  }

  // ---------- manual link ----------

  link(
    fromNamespace: string,
    fromKey: string,
    toNamespace: string,
    toKey: string,
    relation = "related",
  ): boolean {
    const from = this.db
      .prepare<unknown[], { id: number }>(
        `SELECT id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(fromNamespace, fromKey);
    if (!from) {
      throw new Error(
        `no memory at ${fromNamespace}/${fromKey} to link from`,
      );
    }
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO links
         (from_id, to_namespace, to_key, relation, source)
         VALUES (?, ?, ?, ?, 'manual')`,
      )
      .run(from.id, toNamespace, toKey, relation);
    return info.changes > 0;
  }

  // ---------- backlinks ----------

  backlinks(namespace: string, key: string): Backlink[] {
    return this.db
      .prepare<unknown[], Backlink>(
        `SELECT m.namespace AS from_namespace,
                m.key       AS from_key,
                l.relation,
                l.source
         FROM links l
         JOIN memories m ON m.id = l.from_id
         WHERE l.to_namespace = ? AND l.to_key = ?
         ORDER BY m.updated_at DESC`,
      )
      .all(namespace, key);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- store`
Expected: PASS, ~13 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. If `server.ts` errors because it still references removed methods (`write`, `search`, etc.) — that's fine; Task 6 fixes it. Skip this expected error by running `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v server.ts || true` to confirm only server.ts has errors.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts tests/store.test.ts && git commit -m "feat: MemoryStore — note, recall, browse, del, link, backlinks"
```

---

### Task 6: Server — collapse to 7-tool surface

**Files:**
- Replace: `/Users/ben/Documents/Projects/code/memory-fs/src/server.ts`

- [ ] **Step 1: Replace `src/server.ts`**

Write `/Users/ben/Documents/Projects/code/memory-fs/src/server.ts` with:

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import { MemoryStore } from "./store.js";

const memoryType = z.enum(["user", "feedback", "project", "reference", "note"]);
const onConflict = z.enum(["overwrite", "append", "error"]);
const browseKind = z.enum(["index", "recent", "hubs", "orphans", "tags"]);

const db = openDb();
const store = new MemoryStore(db);

const server = new McpServer({ name: "memory-fs", version: "0.1.0" });

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

server.registerTool(
  "memory_note",
  {
    title: "Write a memory",
    description:
      "Save a fact, decision, preference, or piece of context for future sessions. " +
      "Auto-extracts [[wikilinks]] from the content into a backlink graph, and warns " +
      "if a near-duplicate already exists. The key is auto-generated from the first " +
      "heading or first words of content unless you supply one. Namespace is a logical " +
      "scope like 'user', 'project:enzo', or 'agent:reviewer'. " +
      "Use this when the user states something durable ('we picked Clerk for auth'), " +
      "makes a decision, expresses a lasting preference, or explicitly asks to remember. " +
      "Do NOT use for transient task state. IMPORTANT: do not store secrets or PII.",
    inputSchema: {
      content: z.string().min(1).describe("markdown body of the memory; can include [[wikilinks]]"),
      namespace: z.string().min(1).describe("logical scope, e.g. 'user', 'project:enzo'"),
      key: z.string().optional().describe("stable slug; auto-derived from content if omitted"),
      type: memoryType.optional(),
      tags: z.array(z.string()).optional().describe("freeform labels for filtering"),
      on_conflict: onConflict.optional().describe("behavior if (namespace, key) already exists; default 'overwrite'"),
    },
  },
  async (args) => ok(store.note(args)),
);

server.registerTool(
  "memory_recall",
  {
    title: "Search memories",
    description:
      "Retrieve memories matching a query. Returns full records (not snippets), ranked " +
      "by relevance with hub records (frequently-linked memories) promoted. " +
      "Use this when the user asks about something they might have told you before " +
      "('did we already decide on auth?', 'what's the merge freeze date?'), references a " +
      "prior project, or expects you to know context you weren't explicitly told this session. " +
      "Supports FTS5 syntax: phrases (\"merge freeze\"), boolean (auth AND legal), prefix (auth*).",
    inputSchema: {
      query: z.string().min(1).describe("FTS5 search expression"),
      namespace: z.string().optional(),
      type: memoryType.optional(),
      tags: z.array(z.string()).optional(),
      since: z.string().optional().describe("ISO date; only records updated since"),
      limit: z.number().int().positive().max(20).optional().describe("default 5"),
    },
  },
  async (args) => ok(store.recall(args)),
);

server.registerTool(
  "memory_browse",
  {
    title: "Browse the memory store",
    description:
      "Discovery — orient yourself in the store without a specific query. " +
      "Use when you're not sure what's in here, want to summarize what exists, or need " +
      "to find structural records (hubs, orphans, tag vocabulary). " +
      "kind='index' for an overview; 'recent' for last-updated; 'hubs' for highly-linked " +
      "records (these are usually the most important); 'orphans' for unlinked records " +
      "(often stale or in need of integration); 'tags' for the tag vocabulary with counts.",
    inputSchema: {
      kind: browseKind.describe("what view to return"),
      namespace: z.string().optional().describe("filter to this namespace"),
      prefix: z.string().optional().describe("filter keys/tags starting with this prefix"),
      limit: z.number().int().positive().max(100).optional().describe("default 20"),
    },
  },
  async (args) => ok(store.browse(args)),
);

server.registerTool(
  "memory_read",
  {
    title: "Read a memory by exact key",
    description:
      "Fetch a single memory by (namespace, key). Use when you already know the exact " +
      "location — e.g. you got the key from memory_recall, memory_browse, or memory_backlinks. " +
      "Returns null with a hint if no record exists at that location.",
    inputSchema: {
      namespace: z.string().min(1),
      key: z.string().min(1),
    },
  },
  async ({ namespace, key }) => {
    const m = store.read(namespace, key);
    if (!m) {
      return ok({
        found: false,
        hint: `No record at namespace='${namespace}' key='${key}'. Try memory_recall or memory_browse.`,
      });
    }
    return ok(m);
  },
);

server.registerTool(
  "memory_delete",
  {
    title: "Delete a memory",
    description:
      "Permanently delete a memory. Refuses if any other memory links to it (use force=true " +
      "to override, but consider whether the target should just be updated instead). " +
      "Use when the user explicitly asks to forget something or when a memory is clearly wrong.",
    inputSchema: {
      namespace: z.string().min(1),
      key: z.string().min(1),
      force: z.boolean().optional().describe("override the backlink-protection check"),
    },
  },
  async ({ namespace, key, force }) => {
    try {
      const deleted = store.del(namespace, key, force ?? false);
      return ok({ deleted, namespace, key });
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "memory_link",
  {
    title: "Link two memories manually",
    description:
      "Create a directional link between two memories with a relation label. " +
      "Most links are auto-extracted from [[wikilinks]] inside content — use this tool only " +
      "to assert a relationship you can't express in markdown, e.g. 'supersedes' or 'caused-by'. " +
      "Idempotent.",
    inputSchema: {
      from_namespace: z.string().min(1),
      from_key: z.string().min(1),
      to_namespace: z.string().min(1),
      to_key: z.string().min(1),
      relation: z.string().optional().describe("defaults to 'related'"),
    },
  },
  async ({ from_namespace, from_key, to_namespace, to_key, relation }) => {
    const linked = store.link(from_namespace, from_key, to_namespace, to_key, relation);
    return ok({ linked, relation: relation ?? "related" });
  },
);

server.registerTool(
  "memory_backlinks",
  {
    title: "List records that link to a memory",
    description:
      "Return all memories that reference the given (namespace, key) via a link or [[wikilink]]. " +
      "Use to find context around a record — what discussed it, what depends on it, " +
      "what supersedes it. Often more useful than memory_recall for understanding a topic.",
    inputSchema: {
      namespace: z.string().min(1),
      key: z.string().min(1),
    },
  },
  async ({ namespace, key }) => ok(store.backlinks(namespace, key)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual smoke (boot + list tools)**

```bash
rm -f /tmp/memfs-smoke.db*
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | MEMORY_FS_DB=/tmp/memfs-smoke.db npx tsx src/server.ts 2>/dev/null \
  | grep -o '"name":"[^"]*"' | sort -u
```
Expected output (one per line, in some order):
```
"name":"memory-fs"
"name":"memory_backlinks"
"name":"memory_browse"
"name":"memory_delete"
"name":"memory_link"
"name":"memory_note"
"name":"memory_read"
"name":"memory_recall"
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts && git commit -m "feat: collapse server to 7-tool surface"
```

---

### Task 7: End-to-end stdio smoke test

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/tests/server.smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Write `/Users/ben/Documents/Projects/code/memory-fs/tests/server.smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

interface JsonRpcResponse {
  id: number;
  result?: { content?: { text: string }[]; tools?: { name: string }[] };
}

async function callServer(messages: object[]): Promise<JsonRpcResponse[]> {
  const dir = mkdtempSync(join(tmpdir(), "memfs-"));
  const child = spawn("node", ["dist/server.js"], {
    env: { ...process.env, MEMORY_FS_DB: join(dir, "test.db") },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const responses: JsonRpcResponse[] = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) responses.push(JSON.parse(trimmed) as JsonRpcResponse);
  });
  for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  child.stdin.end();
  await new Promise<void>((res) => child.on("close", () => res()));
  return responses;
}

describe("server stdio smoke", () => {
  it("lists 7 tools after initialize", async () => {
    const responses = await callServer([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const list = responses.find((r) => r.id === 2);
    const names = list?.result?.tools?.map((t) => t.name).sort();
    expect(names).toEqual([
      "memory_backlinks",
      "memory_browse",
      "memory_delete",
      "memory_link",
      "memory_note",
      "memory_read",
      "memory_recall",
    ]);
  });

  it("round-trips note → recall → backlinks", async () => {
    const responses = await callServer([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "memory_note",
          arguments: {
            namespace: "test",
            key: "target",
            content: "# Auth Decision\n\nWe picked Clerk.",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "memory_note",
          arguments: {
            namespace: "test",
            key: "src",
            content: "see [[target]] for details",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "memory_recall",
          arguments: { query: "auth Clerk" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "memory_backlinks",
          arguments: { namespace: "test", key: "target" },
        },
      },
    ]);
    const recall = responses.find((r) => r.id === 4);
    const recallText = recall?.result?.content?.[0]?.text ?? "";
    expect(recallText).toContain("Clerk");
    const backlinks = responses.find((r) => r.id === 5);
    const blText = backlinks?.result?.content?.[0]?.text ?? "";
    expect(blText).toContain("from_key");
    expect(blText).toContain("src");
  });
});
```

- [ ] **Step 2: Build first**

Run: `npx tsc`
Expected: zero errors.

- [ ] **Step 3: Run, expect pass**

Run: `npm test -- server.smoke`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/server.smoke.test.ts && git commit -m "test: stdio smoke for 7-tool server"
```

---

### Task 8: Eval prompts — 25 prompts × 5 categories

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/prompts.json`

- [ ] **Step 1: Write the prompts file**

Write `/Users/ben/Documents/Projects/code/memory-fs/eval/prompts.json`:

```json
{
  "categories": {
    "explicit_invocation": {
      "expectation": "should call memory_note",
      "prompts": [
        "Remember that our merge freeze starts May 24, 2026 because mobile is cutting a release branch.",
        "Save this for later: the Enzo auth rewrite is driven by SOC2 evidence collection, not a perf concern.",
        "Note that Alice is on PTO from June 1–10.",
        "File this away: we benchmarked Postgres vs SQLite for the memory store and SQLite + Litestream won on cost.",
        "Add to memory: my preferred onboarding email cadence is day 0, day 2, day 7."
      ]
    },
    "implicit_recall": {
      "expectation": "should call memory_recall or memory_browse without being told",
      "prompts": [
        "Did we already decide what auth provider we're using for Enzo?",
        "What's the merge freeze date again?",
        "I'm picking up the Loops onboarding rewrite — what context do we have on it?",
        "Who's on PTO this week?",
        "Why did we pick SQLite over Postgres for the memory store?"
      ]
    },
    "implicit_write": {
      "expectation": "should call memory_note without being told",
      "prompts": [
        "We just picked Clerk for auth — going to start the migration tomorrow.",
        "Quick update: legal cleared the new privacy policy, we can ship on Monday.",
        "Just realized our staging Postgres is on a different major version than prod. Not great.",
        "We're going to standardize on Vitest across all the TypeScript repos.",
        "Decision: any PR over 500 lines needs two reviewers from now on."
      ]
    },
    "distractor": {
      "expectation": "should NOT call any memory_ tool",
      "prompts": [
        "What's 17 times 23?",
        "Write a fizzbuzz in Python.",
        "Translate 'good morning' to Japanese.",
        "Explain what a B-tree is in two sentences.",
        "What year did the French Revolution start?"
      ]
    },
    "multi_step": {
      "expectation": "should call recall then possibly read or link",
      "prompts": [
        "I'm reviewing a PR for Enzo — refresh me on what we decided about auth last week, then I'll tell you what the PR does.",
        "Pull up our notes on the Loops onboarding rewrite and tell me whether the PR I'm about to share contradicts any of them.",
        "What have I told you about my email-cadence preferences? After you tell me, link those preferences to the current campaign-design notes.",
        "Show me everything tagged 'decision' from the project:enzo namespace and summarize the top three.",
        "Find the merge-freeze note, then check whether we've documented the post-freeze re-enable steps anywhere."
      ]
    }
  }
}
```

- [ ] **Step 2: Verify it parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('eval/prompts.json','utf-8'))" && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add eval/prompts.json && git commit -m "eval: 25 test prompts across 5 categories"
```

---

### Task 9: Eval system-prompt variants A, B, C

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/A-minimal.md`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/B-usage-hints.md`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/C-meta-instruction.md`

- [ ] **Step 1: Write variant A (minimal)**

`/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/A-minimal.md`:

```md
You are an AI assistant helping Ben at his startup. You have memory tools available via MCP.

Tools (one-line descriptions):
- memory_note — write a memory
- memory_recall — search memories
- memory_browse — discovery: kind=index/recent/hubs/orphans/tags
- memory_read — fetch by exact (namespace, key)
- memory_delete — permanently delete a memory
- memory_link — manually link two memories
- memory_backlinks — find records that link to a given memory
```

- [ ] **Step 2: Write variant B (usage hints — predicted winner)**

`/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/B-usage-hints.md`:

```md
You are an AI assistant helping Ben at his startup. You have memory tools available via MCP.

Tools:
- memory_note — save a fact, decision, or preference for future sessions. Use when the user states something durable ("we picked Clerk for auth"), makes a decision, or expresses a lasting preference.
- memory_recall — retrieve memories matching a query. Use when the user references prior decisions, projects, or context you weren't told this session ("did we already decide on X?", "what's our deadline for Y?").
- memory_browse — orient yourself in the store without a specific query. Use when you want to summarize what's in memory or find structural records (hubs, orphans, tags).
- memory_read — fetch a single memory by exact (namespace, key). Use when you already know the key from another call.
- memory_delete — permanently delete a memory. Use when the user explicitly asks to forget something.
- memory_link — manually link two memories. Use to assert relationships ('supersedes', 'caused-by') that aren't already expressed as [[wikilinks]] in content.
- memory_backlinks — find records that link to a given memory. Use to find context around a topic.
```

- [ ] **Step 3: Write variant C (meta-instruction)**

`/Users/ben/Documents/Projects/code/memory-fs/eval/system-prompts/C-meta-instruction.md`:

```md
You are an AI assistant helping Ben at his startup. You have memory tools available via MCP.

IMPORTANT: Reach for memory_recall whenever the user references prior decisions, projects, deadlines, or facts they expect you to know. Reach for memory_note whenever the user states a durable fact, decision, or preference — even if they don't explicitly say "remember this."

Tools (one-line descriptions):
- memory_note — write a memory
- memory_recall — search memories
- memory_browse — discovery: kind=index/recent/hubs/orphans/tags
- memory_read — fetch by exact (namespace, key)
- memory_delete — permanently delete a memory
- memory_link — manually link two memories
- memory_backlinks — find records that link to a given memory
```

- [ ] **Step 4: Commit**

```bash
git add eval/system-prompts/ && git commit -m "eval: A/B/C system-prompt variants"
```

---

### Task 10: Eval runbook + scoring rubric

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/README.md`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/scoring-rubric.md`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/results/.gitkeep`

- [ ] **Step 1: Write `eval/README.md`**

```md
# Memory-fs evaluation harness

Validates whether Claude Haiku 4.5 reaches for memory-fs tools at the right times,
given only the tool descriptions and a system prompt.

## Methodology

- **25 prompts × 5 categories × 5 runs = 125 calls per system-prompt variant**
- **3 variants** (A=minimal, B=usage-hints, C=meta-instruction) → 375 calls per regime
- **2 regimes** (memory-fs alone; memory-fs mixed with ~30 distractor tools from filesystem + github + slack MCP servers) → 750 calls total
- Temperature 1.0 (matches τ-bench convention; pass^5 captures reliability)

## Setup

1. Build the server: `npm run build`
2. Set `ANTHROPIC_API_KEY` in your shell.
3. Run the scripted harness: `node eval/run-eval.mjs` (see Task 11 in the plan).

**MCPJam Inspector** is an optional fallback for visual inspection of individual cells before running the full 750:

1. `npx -y @mcpjam/inspector`
2. Add this server as a local stdio MCP server: command `node`, args `["./dist/server.js"]`, env `MEMORY_FS_DB=/tmp/memfs-eval.db`.
3. Paste the contents of `eval/system-prompts/<variant>.md` into MCPJam's system-prompt field, then a prompt from `eval/prompts.json`, and send (model `claude-haiku-4-5`, temp 1.0).
4. Use MCPJam to sanity-check 10–20 cells; use the scripted harness for the full eval.

## Random tool order

For each run, **randomize the order tools appear in the system prompt** (BFCL found this matters several points). Use `eval/scripts/shuffle-tools.mjs` if you want it automated; manual reordering is fine for 25 prompts.

## Scoring

See `scoring-rubric.md`. Score each trace on six dimensions; report selection accuracy, implicit-trigger rate, false-positive rate, and pass^5.

## Anti-eval-awareness

- Do **not** include the word "evaluation", "test", "experiment", "benchmark" in the system prompt.
- Use realistic Enzo-flavored content; avoid round numbers of options or obviously synthetic phrasing.
- Strip "recall", "remember", "memory" verbs from implicit-category prompts.

## Reporting

After all 750 calls, write a results file `eval/results/SUMMARY.md` with:
- A 3×5 table per regime: variant × category → selection accuracy
- False-positive rate per variant (distractor category)
- pass^5 per variant
- 5 example traces where Haiku made a surprising tool choice
- A verdict: which variant ships?
```

- [ ] **Step 2: Write `eval/scoring-rubric.md`**

```md
# Scoring rubric

For each trace (one Haiku response to one prompt), score these binary/ordinal dimensions:

| Dimension | Score | Definition |
|---|---|---|
| Tool selection | 0/1 | Did Haiku pick the right tool from the 7? |
| Triggered when appropriate | 0/1 | For implicit categories (recall/write) — did it fire without being told? |
| False positive | 0/1 (inverted) | Did it call a memory tool in the distractor category? Lower is better — record as 1 = good (no fp), 0 = bad (fp occurred). |
| Parameter correctness | 0/1/2 | 0 = hallucinated args, 1 = partial, 2 = clean |
| Call ordering | 0/1 | Multi-step only — recall-before-write, etc. |

Then per prompt, compute pass^5 = (# of 5 runs that scored 1 on the primary metric for that category) / 5.

Headline metrics to report:
- **Selection accuracy** — % of trials where the right tool was chosen
- **Implicit-trigger rate** — % of trials in categories `implicit_recall` + `implicit_write` where the tool fired without explicit instruction
- **False-positive rate** — % of trials in `distractor` where a memory_ tool fired (lower is better)
- **pass^5** — fraction of prompts where all 5 runs got tool selection right
```

- [ ] **Step 3: Touch the results placeholder**

```bash
touch /Users/ben/Documents/Projects/code/memory-fs/eval/results/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add eval/README.md eval/scoring-rubric.md eval/results/.gitkeep && git commit -m "eval: runbook and scoring rubric"
```

---

### Task 11: Scripted eval harness

A scripted runner pays back the ~2h of code in ~6h of manual clicking saved on this run alone, and is reusable for every subsequent phase. It calls the Anthropic API directly with `tools` derived from the server's own `tools/list` response, so it tests the *real* schema the agent sees, not a hand-typed copy.

**Files:**
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/run-eval.mjs`
- Create: `/Users/ben/Documents/Projects/code/memory-fs/eval/score.mjs`

- [ ] **Step 1: Add the Anthropic SDK**

```bash
cd /Users/ben/Documents/Projects/code/memory-fs && npm install -D @anthropic-ai/sdk@^0.30.0 @modelcontextprotocol/sdk@^1.0.4
```

(Note: `@modelcontextprotocol/sdk` is already a runtime dep; this just ensures it's present.)

- [ ] **Step 2: Write `eval/run-eval.mjs`**

```js
#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const SERVER_PATH = resolve(import.meta.dirname, "../dist/server.js");
const VARIANTS = ["A-minimal", "B-usage-hints", "C-meta-instruction"];
const REGIMES = ["clean", "mixed"]; // mixed adds distractor servers; see README
const RUNS_PER_PROMPT = 5;
const MODEL = "claude-haiku-4-5";

const prompts = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "prompts.json"), "utf-8"),
);

function loadSystemPrompt(variant) {
  return readFileSync(
    resolve(import.meta.dirname, `system-prompts/${variant}.md`),
    "utf-8",
  );
}

async function discoverMemoryTools() {
  const client = new Client({ name: "eval-runner", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: [SERVER_PATH],
      env: { ...process.env, MEMORY_FS_DB: `/tmp/memfs-eval-${randomUUID()}.db` },
    }),
  );
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function runCell(client, system, tools, userPrompt) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 1.0,
    system,
    tools: shuffle(tools), // randomize tool order per run
    messages: [{ role: "user", content: userPrompt }],
  });
  const calls = res.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name, input: b.input }));
  return { calls, stop_reason: res.stop_reason };
}

async function main() {
  const memoryTools = await discoverMemoryTools();
  const distractorTools = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "distractor-tools.json"), "utf-8"),
  );
  const anthropic = new Anthropic();

  const outDir = resolve(import.meta.dirname, "results");
  mkdirSync(outDir, { recursive: true });

  for (const regime of REGIMES) {
    const tools = regime === "clean" ? memoryTools : [...memoryTools, ...distractorTools];
    for (const variant of VARIANTS) {
      const system = loadSystemPrompt(variant);
      for (const [category, spec] of Object.entries(prompts.categories)) {
        for (const [idx, userPrompt] of spec.prompts.entries()) {
          for (let run = 0; run < RUNS_PER_PROMPT; run++) {
            const result = await runCell(anthropic, system, tools, userPrompt);
            const traceFile = `${regime}-${variant}-${category}-${idx}-run${run}.json`;
            writeFileSync(
              resolve(outDir, traceFile),
              JSON.stringify(
                { regime, variant, category, idx, run, userPrompt, ...result },
                null,
                2,
              ),
            );
            process.stdout.write(".");
          }
        }
      }
      process.stdout.write(`\n${regime}/${variant} done\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Capture distractor tool defs**

Distractor schemas can be hand-curated rather than spawning live servers (faster, deterministic). Save 30 plausible tools from `@modelcontextprotocol/server-filesystem`, `server-github`, `server-slack` to `eval/distractor-tools.json` as a JSON array of `{name, description, input_schema}` objects. Pull them with:

```bash
cd /tmp && \
  npx -y @modelcontextprotocol/server-filesystem /tmp 2>/dev/null < /dev/null | head -1 > /dev/null || true
# Easier: write the file by hand using the README from each server. Ten tools per server × 3 servers = 30.
```

If you'd rather discover live, mirror `discoverMemoryTools()` once per distractor server and concatenate; commit the resulting JSON so the eval is reproducible.

- [ ] **Step 4: Write `eval/score.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "results");
const traces = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "SUMMARY.json")
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));

const EXPECT_MEMORY_TOOL = {
  explicit_invocation: "memory_note",
  implicit_recall: "memory_recall",
  implicit_write: "memory_note",
  multi_step: "memory_recall",
};

const stats = {};
for (const t of traces) {
  const k = `${t.regime}/${t.variant}`;
  stats[k] ??= { total: 0, hit: 0, fp: 0, fpDenom: 0 };
  stats[k].total++;
  const calledMemory = t.calls.some((c) => c.name.startsWith("memory_"));
  if (t.category === "distractor") {
    stats[k].fpDenom++;
    if (calledMemory) stats[k].fp++;
  } else {
    const expected = EXPECT_MEMORY_TOOL[t.category];
    const correct = t.calls.some((c) => c.name === expected);
    if (correct) stats[k].hit++;
  }
}

console.log("Cell\t\t\thits/total\tfp/distractors");
for (const [k, s] of Object.entries(stats)) {
  const hitRate = (s.hit / (s.total - s.fpDenom)) * 100;
  const fpRate = (s.fp / s.fpDenom) * 100;
  console.log(
    `${k.padEnd(28)}${s.hit}/${s.total - s.fpDenom} (${hitRate.toFixed(1)}%)\t${s.fp}/${s.fpDenom} (${fpRate.toFixed(1)}%)`,
  );
}
```

- [ ] **Step 5: Run**

```bash
export ANTHROPIC_API_KEY=...  # set via shell, not in repo
cd /Users/ben/Documents/Projects/code/memory-fs && npm run build
node eval/run-eval.mjs
node eval/score.mjs > eval/results/SUMMARY.txt
```

Expected: ~10 minutes of API calls (750 × ~0.8s with caching). Cost at Haiku 4.5 rates: roughly $0.50-$2.

- [ ] **Step 6: Write SUMMARY**

Read `SUMMARY.txt`, examine a sample of `results/*.json` for surprising traces, then write `eval/results/SUMMARY.md` with the four headline metrics, surprising-trace excerpts, and a verdict on which variant ships.

- [ ] **Step 7: Commit**

```bash
git add eval/run-eval.mjs eval/score.mjs eval/distractor-tools.json eval/results/ && \
  git commit -m "eval: scripted 750-call harness + first run results"
```

> Optional fallback: if you'd rather drive the eval through MCPJam Inspector for visual inspection of a few cells (it's better at showing the reasoning trace), run a small subset manually first — say 15 prompts × 1 variant × 1 regime = 15 calls — to sanity-check the design before kicking off the scripted 750.

---

## Verification

End-to-end verification that Phase 1 is shippable:

1. **Tests green:** `npm test` returns exit 0 with ≥18 tests passing across `slug`, `wikilinks`, `db`, `store`, `server.smoke`.
2. **Tool list correct:** the stdio smoke test in Task 7 confirms 7 tools, names exact.
3. **Round-trip works:** `note → recall → backlinks` round-trip test in Task 7 passes.
4. **Eval signal:** `eval/results/SUMMARY.md` shows at least one variant with implicit-trigger rate ≥ 60% and false-positive rate ≤ 20% in the **mixed** regime (the harder one). If no variant clears both bars, the tool descriptions need a second pass before declaring Phase 1 done.
5. **Manual ergonomics:** open MCPJam, manually try 5 ad-hoc prompts that aren't in the eval set, confirm Haiku reaches for the right tool without coaching.

## Notes for future phases

- **Phase 2** (hybrid search): add `embedding BLOB` column on `memories`, integrate `sqlite-vec`, add reciprocal rank fusion inside `recall`. The `recall` signature can stay unchanged.
- **Phase 3** (dedup-on-write + temporal): the `near_duplicate_warning` field on `note` already exists; Phase 3 upgrades the similarity from FTS5 to embeddings and adds `valid_from`/`superseded_by`/`superseded_at` columns. The `note` signature can grow an `on_duplicate: "warn"|"merge"|"supersede"` parameter.
- **Phase 4** (`memory_reflect` + pinned blocks): a new tool, no signature changes to existing ones.
- **Phase 5** (hosted): replace `StdioServerTransport` with `StreamableHTTPServerTransport`, add bearer-token middleware, package as Docker image.
