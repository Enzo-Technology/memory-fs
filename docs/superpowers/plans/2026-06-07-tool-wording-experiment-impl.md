# Tool-Wording Experiment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the instrumentation to measure whether MCP tool wording (memory/context/knowledge) steers what models read, write, and prune in the enzo shared store, then run the pilot to a go/no-go gate.

**Architecture:** A renameable MCP stdio wrapper (`eval/server/`) re-exposes the existing `MemoryStore` under neutral verbs whose names/descriptions/result-strings come from `conditions.json`, keyed by a `NAMING` env var. An agentic harness (extending the existing `eval/run-eval.mjs` pattern — Anthropic SDK + MCP stdio client, now with a tool-execution loop and fabricated-history support) runs scripted conversations, archives full transcripts, and a deterministic scorer + blinded LLM judge compute metrics from the archive. No MCPJam SDK dependency.

**Tech Stack:** Node ≥20 ESM, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `vitest`. Harness/scorer/judge as `.mjs` (matches existing `eval/`); wrapper imports compiled `dist/` modules.

**Spec:** `docs/plans/2026-06-07-tool-wording-experiment.md` (specrev:2). Section refs below (§N) point there.

**Guiding principle (carried from the design discussion):** minimal new code, one high-affordance generic wrapper, friction in the mechanism not in a manual. Do not add features the pilot doesn't need.

---

## File Structure

**New:**
- `eval/conditions.json` — the 7 wording surfaces (M, C, K, N, MxC, CxM, PROD-marker). The manipulation, version-controlled.
- `eval/server/index.mjs` — renameable wrapper server (stdio). Registers 7 neutral-verb tools, delegates to `MemoryStore`, applies names/descriptions/result-strings from `conditions.json[NAMING]`.
- `eval/lib/conditions.mjs` — load + validate `conditions.json`; build the tool registration list for a condition.
- `eval/fixtures/seed-records.json` — store seed (Appendix B of spec).
- `eval/fixtures/seed-db.mjs` — builds a fresh seeded SQLite file from `seed-records.json`.
- `eval/fixtures/p2-history.json`, `eval/fixtures/p3-history.json` — fabricated conversation histories.
- `eval/fixtures/p3-manifest.json` — the 5 plantable items + ideal filing, for scoring.
- `eval/scripts.mjs` — the frozen probe turns (P1/T1, P1/T2, P2/T3-T5, P3b) and which fixture history each uses.
- `eval/wording-run.mjs` — the experiment harness (agentic loop, matrix, archival).
- `eval/wording-score.mjs` — deterministic metrics m1–m8 from the archive.
- `eval/wording-judge.mjs` — blinded judge j1–j4 + κ spot-check helper.
- `eval/analysis.mjs` — Wilson CIs + risk differences per preregistered pair → `RESULTS.md`.
- `research/memory-rhythms.md` — background research the preregistration rests on.
- Tests under `tests/eval/`: `conditions.test.ts`, `wrapper.test.ts`, `seed-db.test.ts`, `fixtures.test.ts`, `score.test.ts`, `judge-parse.test.ts`, `analysis.test.ts`.

**Modified:**
- `package.json` — add `eval:pilot`, `eval:full`, `eval:score`, `eval:judge`, `eval:analyze`, `eval:snapshot` scripts.
- `.gitignore` — add `eval/artifacts/`.

**Untouched:** all of `src/`. PROD condition runs the real `dist/index.js`; every other condition runs the wrapper. Production code is never edited for this experiment.

---

## Milestone 0 — Scaffolding

### Task 1: conditions.json + loader with validation

**Files:**
- Create: `eval/conditions.json`
- Create: `eval/lib/conditions.mjs`
- Test: `tests/eval/conditions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/conditions.test.ts`
Expected: FAIL — cannot find module `eval/lib/conditions.mjs`.

- [ ] **Step 3: Write `eval/conditions.json`**

```json
{
  "M":   { "noun": "memory",    "framing": "memory" },
  "C":   { "noun": "context",   "framing": "context" },
  "K":   { "noun": "knowledge", "framing": "knowledge" },
  "N":   { "noun": "store",     "framing": "neutral" },
  "MxC": { "noun": "memory",    "framing": "context" },
  "CxM": { "noun": "context",   "framing": "memory" },

  "framings": {
    "memory": {
      "write":     "Save a memory. Use this to remember information about the user and past conversations for later.",
      "read":      "Read a memory you saved earlier, by its exact location.",
      "search":    "Search your memories about the user and past conversations by keyword.",
      "browse":    "Look over the memories you have saved so far.",
      "link":      "Connect two memories so you can recall them together later.",
      "backlinks": "Find which of your memories refer back to this one.",
      "delete":    "Forget a memory you no longer need to keep."
    },
    "context": {
      "write":     "Write a record to the shared context the team and other codebases rely on: key information, decisions, skills, direction. Update it when direction changes.",
      "read":      "Read a shared-context record by its exact location before you act on it.",
      "search":    "Search the shared team context by keyword; read it before acting.",
      "browse":    "Survey the shared team context so you know what the team already relies on.",
      "link":      "Relate two shared-context records so the team can navigate between them.",
      "backlinks": "Find which shared-context records depend on this one.",
      "delete":    "Remove a shared-context record that no longer reflects the team's direction."
    },
    "knowledge": {
      "write":     "Add an entry to the team knowledge base: settled facts, conventions, and reference material that are established and durable.",
      "read":      "Read a knowledge-base entry by its exact location.",
      "search":    "Search the team knowledge base of settled facts and conventions by keyword.",
      "browse":    "Survey the team knowledge base of settled facts and conventions.",
      "link":      "Relate two knowledge-base entries so readers can navigate between them.",
      "backlinks": "Find which knowledge-base entries reference this one.",
      "delete":    "Remove a knowledge-base entry that is no longer established or correct."
    },
    "neutral": {
      "write":     "Write a record to the store.",
      "read":      "Read a record from the store by its exact location.",
      "search":    "Search records by keyword.",
      "browse":    "List records in the store.",
      "link":      "Relate two records.",
      "backlinks": "Find records that reference this one.",
      "delete":    "Delete a record."
    }
  },

  "resultStrings": {
    "memory":    { "write": "Memory saved.",            "delete": "Memory forgotten." },
    "context":   { "write": "Shared context updated.",  "delete": "Shared-context record removed." },
    "knowledge": { "write": "Knowledge base entry added.", "delete": "Knowledge-base entry removed." },
    "neutral":   { "write": "Record written.",          "delete": "Record deleted." }
  }
}
```

- [ ] **Step 4: Write `eval/lib/conditions.mjs`**

```javascript
// eval/lib/conditions.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const VERBS = ["write", "read", "search", "browse", "link", "backlinks", "delete"];

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../conditions.json"), "utf-8"),
);

// Expand the compact {noun, framing} spec into a full per-condition surface:
// name = `${noun}_${verb}`, description = framings[framing][verb], result strings
// follow the framing. Crossed conditions (MxC/CxM) take noun from one framing and
// descriptions from another — that's the whole point, so we resolve them explicitly.
export function loadConditions() {
  const out = {};
  for (const id of ["M", "C", "K", "N", "MxC", "CxM"]) {
    const { noun, framing } = raw[id];
    const desc = raw.framings[framing];
    const tools = {};
    for (const verb of VERBS) {
      tools[verb] = { name: `${noun}_${verb}`, description: desc[verb] };
    }
    out[id] = {
      id, noun, framing, tools,
      resultStrings: raw.resultStrings[framing] ?? raw.resultStrings.neutral,
    };
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/eval/conditions.test.ts`
Expected: PASS (3 tests). If the ±15% length test fails, hand-tune the three `write` descriptions in `conditions.json` to equal length within tolerance — framing words differ, information content does not.

- [ ] **Step 6: Commit**

```bash
git add eval/conditions.json eval/lib/conditions.mjs tests/eval/conditions.test.ts
git commit -m "feat(eval): wording conditions surface + loader"
```

### Task 2: package.json scripts + gitignore

**Files:**
- Modify: `package.json` (scripts block)
- Modify: `.gitignore`

- [ ] **Step 1: Add scripts to `package.json`**

Add these to the `"scripts"` object:

```json
"eval:snapshot": "node eval/snapshot-surfaces.mjs",
"eval:pilot": "node eval/wording-run.mjs --pilot",
"eval:full": "node eval/wording-run.mjs --full",
"eval:score": "node eval/wording-score.mjs",
"eval:judge": "node eval/wording-judge.mjs",
"eval:analyze": "node eval/analysis.mjs"
```

- [ ] **Step 2: Add to `.gitignore`**

```
eval/artifacts/
```

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore(eval): npm scripts + ignore artifacts"
```

---

## Milestone 1 — Renameable wrapper server

### Task 3: wrapper server that re-exposes the store under a condition

**Files:**
- Create: `eval/server/index.mjs`
- Test: `tests/eval/wrapper.test.ts`

**Background for the implementer:** `MemoryStore` (`src/core/store.ts`, compiled to `dist/core/store.js`) exposes `note(input, author)`, `read(ns, key)`, `recall(input)`, `browse(input)`, `link(fromNs, fromKey, toNs, toKey, relation)`, `backlinks(ns, key)`, `del(ns, key, force)`. The MCP SDK's `McpServer.registerTool(name, {title, description, annotations, inputSchema}, handler)` is used in `src/lib/mcp-server.ts` — mirror that. `inputSchema` is a zod *shape* (object of zod fields). Argument names are held constant across all conditions; only tool `name`/`description`/result-string vary.

- [ ] **Step 1: Write the failing test**

The wrapper is a stdio MCP server; test it through an in-process MCP client, the way `tests/server.smoke.test.ts` exercises the real server. Build first so `dist/` exists.

```typescript
// tests/eval/wrapper.test.ts
import { describe, expect, it, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function connect(naming: string) {
  const db = join(mkdtempSync(join(tmpdir(), "memfs-wrap-")), "w.db");
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [resolve(__dirname, "../../eval/server/index.mjs")],
    env: { ...process.env, NAMING: naming, MEMORY_FS_DB: db },
  }));
  return client;
}

describe("wrapper server", () => {
  it("exposes context_* names under NAMING=C", async () => {
    const client = await connect("C");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("context_write");
    expect(names).toContain("context_search");
    expect(names).not.toContain("memory_write");
    await client.close();
  });

  it("write then search round-trips through the real store", async () => {
    const client = await connect("C");
    await client.callTool({ name: "context_write", arguments: {
      namespace: "project:enzo", key: "x", content: "the auth provider is Clerk",
    }});
    const res = await client.callTool({ name: "context_search", arguments: { query: "auth" }});
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("Clerk");
    await client.close();
  });

  it("write result carries the condition's result string", async () => {
    const client = await connect("K");
    const res = await client.callTool({ name: "knowledge_write", arguments: {
      namespace: "project:enzo", key: "y", content: "we use Vitest",
    }});
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("Knowledge base entry added.");
    await client.close();
  });
});
```

- [ ] **Step 2: Build, then run test to verify it fails**

Run: `npm run build && npx vitest run tests/eval/wrapper.test.ts`
Expected: FAIL — `eval/server/index.mjs` does not exist.

- [ ] **Step 3: Write `eval/server/index.mjs`**

```javascript
// eval/server/index.mjs — renameable MCP stdio wrapper around the production store.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "../../dist/core/db.js";
import { MemoryStore } from "../../dist/core/store.js";
import { loadConditions } from "../lib/conditions.mjs";

const NAMING = process.env.NAMING;
const cond = loadConditions()[NAMING];
if (!cond) {
  console.error(`[wrapper] unknown NAMING='${NAMING}' (expect M|C|K|N|MxC|CxM)`);
  process.exit(1);
}

const store = new MemoryStore(openDb()); // MEMORY_FS_DB selects the file

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const okWith = (prefix, data) => ({
  content: [{ type: "text", text: `${prefix}\n${JSON.stringify(data, null, 2)}` }],
});

// Argument schemas are IDENTICAL across conditions — only name/description vary.
const memoryType = z.enum(["user", "feedback", "project", "reference", "note"]);
const schemas = {
  write: {
    content: z.string().min(1), namespace: z.string().min(1), key: z.string().optional(),
    type: memoryType.optional(), tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(), source: z.string().optional(),
    on_conflict: z.enum(["overwrite", "append", "error"]).optional(),
  },
  read:   { namespace: z.string().min(1), key: z.string().min(1) },
  search: { query: z.string().min(1), namespace: z.string().optional(), type: memoryType.optional(),
            tags: z.array(z.string()).optional(), since: z.string().optional(),
            limit: z.number().int().positive().max(20).optional() },
  browse: { kind: z.enum(["index","recent","hubs","orphans","tags","namespaces"]),
            namespace: z.string().optional(), prefix: z.string().optional(),
            limit: z.number().int().positive().max(100).optional() },
  link:   { from_namespace: z.string().min(1), from_key: z.string().min(1),
            to_namespace: z.string().min(1), to_key: z.string().min(1), relation: z.string().optional() },
  backlinks: { namespace: z.string().min(1), key: z.string().min(1) },
  delete: { namespace: z.string().min(1), key: z.string().min(1), force: z.boolean().optional() },
};

// Each verb's handler delegates to the same store method regardless of condition.
const handlers = {
  write: (a) => okWith(cond.resultStrings.write, store.note(a, null)),
  read:  (a) => {
    const m = store.read(a.namespace, a.key);
    return ok(m ?? { found: false, hint: `No record at namespace='${a.namespace}' key='${a.key}'.` });
  },
  search: (a) => ok(store.recall(a)),
  browse: (a) => ok(store.browse(a)),
  link:   (a) => ok({ linked: store.link(a.from_namespace, a.from_key, a.to_namespace, a.to_key, a.relation),
                      relation: a.relation ?? "related" }),
  backlinks: (a) => ok(store.backlinks(a.namespace, a.key)),
  delete: (a) => {
    try { return ok({ deleted: store.del(a.namespace, a.key, a.force ?? false), ...a }); }
    catch (e) { return { content: [{ type: "text", text: String(e.message) }], isError: true }; }
  },
};

const server = new McpServer({ name: `wording-${NAMING}`, version: "0.1.0" });
const readOnly = new Set(["read", "search", "browse", "backlinks"]);
for (const verb of Object.keys(schemas)) {
  const t = cond.tools[verb];
  server.registerTool(
    t.name,
    { title: t.name, description: t.description,
      annotations: verb === "delete" ? { destructiveHint: true } : { readOnlyHint: readOnly.has(verb) },
      inputSchema: schemas[verb] },
    async (args) => handlers[verb](args),
  );
}

await server.connect(new StdioServerTransport());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eval/wrapper.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add eval/server/index.mjs tests/eval/wrapper.test.ts
git commit -m "feat(eval): renameable MCP wrapper over the store"
```

### Task 4: tool-surface snapshots (the manipulation, committed)

**Files:**
- Create: `eval/snapshot-surfaces.mjs`
- Create (output): `eval/surfaces/<COND>.json` (committed)

- [ ] **Step 1: Write `eval/snapshot-surfaces.mjs`**

```javascript
// eval/snapshot-surfaces.mjs — list each condition's live tool surface and commit it,
// so the exact manipulation is part of the record (per spec §5/§7).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const CONatDS = ["M", "C", "K", "N", "MxC", "CxM"];
const outDir = resolve(import.meta.dirname, "surfaces");
mkdirSync(outDir, { recursive: true });

for (const NAMING of CONatDS) {
  const client = new Client({ name: "snap", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [resolve(import.meta.dirname, "server/index.mjs")],
    env: { ...process.env, NAMING, MEMORY_FS_DB: `/tmp/snap-${randomUUID()}.db` },
  }));
  const { tools } = await client.listTools();
  await client.close();
  const surface = tools
    .map((t) => ({ name: t.name, description: t.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resolve(outDir, `${NAMING}.json`), JSON.stringify(surface, null, 2));
  console.log(`snapshot ${NAMING}: ${tools.length} tools`);
}
```

Fix the obvious typo before saving: the constant is `const CONDS = ["M","C","K","N","MxC","CxM"];` — use `CONDS` everywhere in this file. (Written deliberately so the implementer reads the code rather than pasting blind.)

- [ ] **Step 2: Run it**

Run: `npm run build && npm run eval:snapshot`
Expected: 6 lines `snapshot <X>: 7 tools`, files written under `eval/surfaces/`.

- [ ] **Step 3: Commit the snapshots**

```bash
git add eval/snapshot-surfaces.mjs eval/surfaces/
git commit -m "chore(eval): snapshot the six tool-wording surfaces"
```

---

## Milestone 2 — Fixtures

### Task 5: seed records + seed-db builder

**Files:**
- Create: `eval/fixtures/seed-records.json`
- Create: `eval/fixtures/seed-db.mjs`
- Test: `tests/eval/seed-db.test.ts`

- [ ] **Step 1: Write `eval/fixtures/seed-records.json`**

```json
[
  { "namespace": "project:enzo", "key": "core-pain", "type": "project",
    "tags": ["core-pain", "thesis-under-test"],
    "content": "## Enzo — Core Pain (hardened 2026-06-05, thesis-under-test)\n\nReps drown in accounts and can't tell which one needs them next. The pain is judgment-at-scale: knowing the next best action per account, not logging activity. Hardened 2026-06-05 as the live strategic anchor." },
  { "namespace": "project:enzo", "key": "what-we-solve-for", "type": "project",
    "tags": ["anchor", "north-star", "positioning"],
    "content": "## What Enzo solves for\n\nA proactive next-best-action layer over the rep's book of business. Ships as a CLI plus a desktop app for non-technical reps." },
  { "namespace": "project:enzo", "key": "deploy-smoke", "type": "note",
    "tags": ["deploy", "smoke"],
    "content": "# Hosted deploy smoke\n\nManual curl checklist run after each deploy to verify the box is up." },
  { "namespace": "reference", "key": "stack-conventions", "type": "reference",
    "tags": ["reference"],
    "content": "## Stack conventions\n\nTypeScript everywhere; pnpm workspaces; conventional commits." },
  { "namespace": "reference", "key": "oncall-rotation", "type": "reference",
    "tags": ["reference"],
    "content": "## On-call\n\nWeekly rotation, handoff Mondays 10:00." }
]
```

- [ ] **Step 2: Write the failing test**

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/eval/seed-db.test.ts`
Expected: FAIL — `eval/fixtures/seed-db.mjs` not found.

- [ ] **Step 4: Write `eval/fixtures/seed-db.mjs`**

```javascript
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
```

Note for the implementer: the test imports `openDb`/`MemoryStore` from `src/` (vitest runs TS), but `seed-db.mjs` imports from `dist/` (the harness runs compiled). Keep both — they are the same code through two entry points. Run `npm run build` before the test so `dist/` is current.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/eval/seed-db.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add eval/fixtures/seed-records.json eval/fixtures/seed-db.mjs tests/eval/seed-db.test.ts
git commit -m "feat(eval): seed records + fresh-db builder"
```

### Task 6: scripts + fabricated histories + manifest, with a contract test

**Files:**
- Create: `eval/scripts.mjs`
- Create: `eval/fixtures/p2-history.json`, `eval/fixtures/p3-history.json`, `eval/fixtures/p3-manifest.json`
- Test: `tests/eval/fixtures.test.ts`

**Authoring contract (enforced by the test, not left to taste):**
- Histories are arrays of `{ "role": "user" | "assistant", "content": "..." }`.
- **Zero tool calls** — no `tool_use`/`tool_result` blocks; content is plain strings only (§4).
- **Zero store vocabulary** — case-insensitive, none of: `memory`, `context`, `knowledge`, `notes`, `the store`, `recall`, and no tool name fragment `_write`/`_search`/etc. (§4).
- `p2-history.json`: ~10 turns, an enzo CLI onboarding-flow working session.
- `p3-history.json`: ~30 turns, ~6–8k tokens, containing the 5 plantable items named in `p3-manifest.json` and establishing `deploy-smoke` as obsolete.
- `p3-manifest.json`: `{ items: [{ id, kind: "durable"|"reverted"|"aside"|"deferred", gist, shouldFile: boolean }] }` with exactly 2 `durable` (shouldFile true), 1 `reverted` (false), 1 `aside` (false), 1 `deferred` (false).

- [ ] **Step 1: Write the failing contract test**

```typescript
// tests/eval/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const load = (p: string) => JSON.parse(readFileSync(resolve(__dirname, "../../eval/fixtures", p), "utf-8"));
const BANNED = /\b(memory|context|knowledge|notes?|the store|recall)\b|_(write|read|search|browse|link|backlinks|delete)\b/i;

function assertHistory(turns: any[]) {
  expect(Array.isArray(turns)).toBe(true);
  for (const t of turns) {
    expect(["user", "assistant"]).toContain(t.role);
    expect(typeof t.content).toBe("string"); // no tool blocks
    expect(t.content).not.toMatch(BANNED);
  }
}

describe("fabricated histories", () => {
  it("p2: ~10 turns, no tool calls, no store vocabulary", () => {
    const h = load("p2-history.json");
    expect(h.length).toBeGreaterThanOrEqual(8);
    expect(h.length).toBeLessThanOrEqual(14);
    assertHistory(h);
  });

  it("p3: long, no tool calls, no store vocabulary", () => {
    const h = load("p3-history.json");
    expect(h.length).toBeGreaterThanOrEqual(24);
    const chars = h.reduce((n: number, t: any) => n + t.content.length, 0);
    expect(chars).toBeGreaterThan(18000); // ~6k+ tokens
    assertHistory(h);
  });

  it("p3 manifest: exactly 2 durable / 1 reverted / 1 aside / 1 deferred", () => {
    const m = load("p3-manifest.json");
    const by = (k: string) => m.items.filter((i: any) => i.kind === k).length;
    expect(by("durable")).toBe(2);
    expect(by("reverted")).toBe(1);
    expect(by("aside")).toBe(1);
    expect(by("deferred")).toBe(1);
    expect(m.items.filter((i: any) => i.shouldFile).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/fixtures.test.ts`
Expected: FAIL — fixture files not found.

- [ ] **Step 3: Author the three fixtures to satisfy the contract**

Write `p2-history.json`, `p3-history.json`, `p3-manifest.json` as enzo-flavored prose meeting every assertion above. Keep the writing realistic (no round numbers, no synthetic phrasing — §9). `p3-manifest.json` shape:

```json
{
  "items": [
    { "id": "errfmt", "kind": "durable", "gist": "all CLI errors use EnzoError with a code", "shouldFile": true },
    { "id": "telemetry-optout", "kind": "durable", "gist": "telemetry is opt-out, documented in README", "shouldFile": true },
    { "id": "config-format", "kind": "reverted", "gist": "considered TOML for config, reverted to JSON same session", "shouldFile": false },
    { "id": "rex", "kind": "aside", "gist": "Ben's dog Rex barked at the mailman", "shouldFile": false },
    { "id": "auth-provider", "kind": "deferred", "gist": "auth provider choice explicitly deferred to next week", "shouldFile": false }
  ]
}
```

Then write the two histories so the P3 history naturally contains these five items and establishes `deploy-smoke` as obsolete (e.g. "the manual curl checklist is gone now that CI does it").

- [ ] **Step 4: Write `eval/scripts.mjs` (frozen probe turns)**

```javascript
// eval/scripts.mjs — frozen probe turns. User turns NEVER name the store (§4).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const fx = (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", f), "utf-8"));

export const SCRIPTS = {
  P1: { history: [], turns: [
    { id: "T1", fresh: true, text: "Draft a one-line headline for the enzo landing page." },
    { id: "T2", fresh: true, text: "What's our core pain hypothesis, and when did we last harden it?" },
  ]},
  P2: { history: fx("p2-history.json"), turns: [
    { id: "T3", text: "Quick update before we continue — we talked it over this morning and we're killing the desktop app. CLI-first is the bet now. Carry on with the onboarding flow." },
    { id: "T4", text: "ha, sorry, got distracted — my dog Rex was barking at the mailman. anyway, where were we?" },
    { id: "T5", text: "One more thing to lock in: all enzo CLI errors go through the new `EnzoError` type with an error code — that's the convention from now on, every crate." },
  ]},
  P3b: { history: fx("p3-history.json"), turns: [
    { id: "P3b", text: "Before we close out: wrap up — make sure anything the team needs survives this session, and tidy up anything stale." },
  ]},
};
```

Note: T1 and T2 both carry `fresh: true` — each runs in its own conversation (the m2 contamination fix, §4). T3–T5 share one conversation atop the P2 history.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/eval/fixtures.test.ts`
Expected: PASS (3 tests). If BANNED matches, reword the offending history turn — the vocabulary leak is a real confound, not a test nuisance.

- [ ] **Step 6: Commit**

```bash
git add eval/scripts.mjs eval/fixtures/p2-history.json eval/fixtures/p3-history.json eval/fixtures/p3-manifest.json tests/eval/fixtures.test.ts
git commit -m "feat(eval): frozen probe scripts + fabricated histories + p3 manifest"
```

---

## Milestone 3 — Harness

### Task 7: agentic tool-execution loop

**Files:**
- Create: `eval/lib/agent-loop.mjs`
- Test: `tests/eval/agent-loop.test.ts`

**Why new code:** the existing `eval/run-eval.mjs` is single-shot — it records the tool calls in the first response but never executes them or continues. m1 ("read before the first non-tool answer token") and the supersede/prune metrics need the model to call a tool, receive the result, and then act. So we need a real loop: call the model, execute every `tool_use` against the MCP client, feed `tool_result` back, repeat to a step cap, recording the ordered tool calls and whether any assistant text preceded the first tool call.

- [ ] **Step 1: Write the failing test (with a fake model + fake MCP client)**

```typescript
// tests/eval/agent-loop.test.ts
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../../eval/lib/agent-loop.mjs";

// Fake Anthropic: first response calls a tool, second responds with text.
function fakeAnthropic(script: any[]) {
  let i = 0;
  return { messages: { create: async () => script[i++] } };
}
const toolUse = (name: string, input: any) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu_1", name, input }],
});
const textMsg = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const fakeMcp = { callTool: async () => ({ content: [{ type: "text", text: "result" }] }) };

describe("agent loop", () => {
  it("executes tool calls and continues to a final text answer", async () => {
    const anthropic = fakeAnthropic([toolUse("context_search", { query: "auth" }), textMsg("done")]);
    const r = await runAgentLoop({ anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.toolCalls.map((c) => c.name)).toEqual(["context_search"]);
    expect(r.readBeforeAnswer).toBe(true);  // tool call came before any assistant text
    expect(r.finalText).toBe("done");
  });

  it("flags readBeforeAnswer=false when the model answers without any tool call", async () => {
    const anthropic = fakeAnthropic([textMsg("here you go")]);
    const r = await runAgentLoop({ anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [], messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.toolCalls).toEqual([]);
    expect(r.readBeforeAnswer).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/agent-loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `eval/lib/agent-loop.mjs`**

```javascript
// eval/lib/agent-loop.mjs — minimal multi-step tool loop over the Anthropic SDK.
// Records ordered tool calls and whether any tool ran before the first assistant text.
export async function runAgentLoop({ anthropic, mcp, model, system, tools, messages, maxSteps = 10, temperature = 1.0 }) {
  const convo = messages.slice();
  const toolCalls = [];
  let readBeforeAnswer = false;
  let sawText = false;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    const res = await anthropic.messages.create({
      model, max_tokens: 1024, temperature, system, tools, messages: convo,
    });
    const textBlocks = res.content.filter((b) => b.type === "text");
    const toolBlocks = res.content.filter((b) => b.type === "tool_use");

    if (textBlocks.length) { sawText = true; finalText = textBlocks.map((b) => b.text).join("\n"); }
    for (const b of toolBlocks) {
      if (!sawText && toolCalls.length === 0) readBeforeAnswer = true; // first action was a tool call
      toolCalls.push({ name: b.name, input: b.input });
    }

    if (res.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      return { toolCalls, readBeforeAnswer, finalText, steps: step + 1, stopReason: res.stop_reason };
    }

    convo.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of toolBlocks) {
      let out;
      try { out = await mcp.callTool({ name: b.name, arguments: b.input }); }
      catch (e) { out = { content: [{ type: "text", text: `error: ${e.message}` }], isError: true }; }
      results.push({ type: "tool_result", tool_use_id: b.id, content: out.content });
    }
    convo.push({ role: "user", content: results });
  }
  return { toolCalls, readBeforeAnswer, finalText, steps: maxSteps, stopReason: "max_steps" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eval/agent-loop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add eval/lib/agent-loop.mjs tests/eval/agent-loop.test.ts
git commit -m "feat(eval): agentic tool-execution loop"
```

### Task 8: experiment runner (matrix + fresh seeded DB + archival)

**Files:**
- Create: `eval/wording-run.mjs`

**No unit test** — this orchestrates live API + subprocess MCP servers; the pilot run (Task 12) is its integration test. Keep it thin; all testable logic lives in `agent-loop.mjs`, `conditions.mjs`, `seed-db.mjs` (already covered).

- [ ] **Step 1: Write `eval/wording-run.mjs`**

```javascript
// eval/wording-run.mjs — run the wording experiment matrix, archive every transcript.
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAgentLoop } from "./lib/agent-loop.mjs";
import { buildSeedDb } from "./fixtures/seed-db.mjs";
import { SCRIPTS } from "./scripts.mjs";

const NEUTRAL_SP =
  "You are an engineering assistant working with the enzo team. You have access to tools. Help the user with their requests.";
const WRAPPER = resolve(import.meta.dirname, "server/index.mjs");
const REAL_SERVER = resolve(import.meta.dirname, "../dist/index.js");
const ARTIFACTS = resolve(import.meta.dirname, "artifacts");

// VERIFY these IDs against the API before a full run (spec §3, /claude-api).
const MODELS = { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6", opus: "claude-opus-4-8" };

// --pilot: M+C × sonnet × P1,P2,P3b × n=5. --full: the §3 concentrated grid (fill in after pilot).
const PILOT = process.argv.includes("--pilot");
const MATRIX = PILOT
  ? { conditions: ["M", "C"], models: ["sonnet"], scripts: ["P1", "P2", "P3b"], n: 5 }
  : { conditions: ["M", "C", "K", "N", "MxC", "CxM", "PROD"], models: ["haiku", "sonnet", "opus"], scripts: ["P1", "P2", "P3b"], n: 20 };

function shuffleLogged(tools) {
  const order = tools.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { tools: order.map((i) => tools[i]), order };
}

async function connectServer(condition, dbPath) {
  const isProd = condition === "PROD";
  const client = new Client({ name: "wording-run", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [isProd ? REAL_SERVER : WRAPPER],
    env: { ...process.env, MEMORY_FS_DB: dbPath, ...(isProd ? {} : { NAMING: condition }) },
  }));
  const { tools } = await client.listTools();
  return { client, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) };
}

async function runScript({ anthropic, condition, model, scriptId }) {
  const script = SCRIPTS[scriptId];
  const transcripts = [];
  // Probes flagged `fresh` get their own conversation + own seeded DB; the rest
  // share one conversation atop the fabricated history (spec §4).
  let shared = null;
  for (const turn of script.turns) {
    if (turn.fresh || !shared) {
      const dbPath = `/tmp/memfs-wording-${randomUUID()}.db`;
      buildSeedDb(dbPath);
      const { client, tools } = await connectServer(condition, dbPath);
      const { tools: shuffled, order } = shuffleLogged(tools);
      shared = { client, tools: shuffled, order, dbPath, messages: script.history.slice() };
    }
    shared.messages.push({ role: "user", content: turn.text });
    const r = await runAgentLoop({ anthropic, mcp: shared.client, model: MODELS[model],
      system: NEUTRAL_SP, tools: shared.tools, messages: shared.messages, maxSteps: 10 });
    shared.messages.push({ role: "assistant", content: r.finalText });
    transcripts.push({ turn: turn.id, toolOrder: shared.order, ...r });
    if (turn.fresh) { await shared.client.close(); shared = null; }
  }
  if (shared) await shared.client.close();
  return transcripts;
}

async function main() {
  const anthropic = new Anthropic();
  for (const condition of MATRIX.conditions)
    for (const model of MATRIX.models)
      for (const scriptId of MATRIX.scripts)
        for (let iter = 0; iter < MATRIX.n; iter++) {
          let transcripts;
          try { transcripts = await runScript({ anthropic, condition, model, scriptId }); }
          catch (e) { console.error(`\n[excluded] ${condition}/${model}/${scriptId}#${iter}: ${e.message}`); continue; }
          const dir = resolve(ARTIFACTS, condition, model, scriptId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${iter}.json`),
            JSON.stringify({ condition, model, scriptId, iter, transcripts }, null, 2));
          process.stdout.write(".");
        }
  process.stdout.write("\ndone\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke-check it parses and the matrix is the pilot**

Run: `node -e "import('./eval/wording-run.mjs').catch(e=>{})" ` is not meaningful (it runs). Instead dry-check syntax:
Run: `node --check eval/wording-run.mjs`
Expected: no output (valid syntax). Do **not** run the full thing yet — that's Task 12.

- [ ] **Step 3: Commit**

```bash
git add eval/wording-run.mjs
git commit -m "feat(eval): wording experiment runner (pilot + full matrix)"
```

---

## Milestone 4 — Scoring

### Task 9: deterministic metrics m1–m8

**Files:**
- Create: `eval/wording-score.mjs`
- Test: `tests/eval/score.test.ts`

**Note on joint metrics (spec §6):** m3 splits into m3a (did the model read `what-we-solve-for` before acting on T3) and m3b (given a read, did it update the existing key vs duplicate vs nothing). m7 likewise pairs a read with the prune action. Scoring reports both parts; never collapse them.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/eval/score.test.ts
import { describe, expect, it } from "vitest";
import { scoreTurn } from "../../eval/wording-score.mjs";

describe("scoring", () => {
  it("m1: counts a read tool before the answer", () => {
    const t = { turn: "T1", readBeforeAnswer: true, toolCalls: [{ name: "context_search", input: { query: "enzo" } }], finalText: "Enzo: ..." };
    expect(scoreTurn(t).m1).toBe(1);
  });
  it("m1: zero when no tool preceded the answer", () => {
    expect(scoreTurn({ turn: "T1", readBeforeAnswer: false, toolCalls: [], finalText: "Enzo!" }).m1).toBe(0);
  });
  it("m2: requires both a read and the exact hardened date", () => {
    const good = { turn: "T2", toolCalls: [{ name: "context_search", input: { query: "core pain" } }], finalText: "core pain, hardened 2026-06-05" };
    const hallucinated = { turn: "T2", toolCalls: [], finalText: "hardened 2026-05-01" };
    expect(scoreTurn(good).m2).toBe(1);
    expect(scoreTurn(hallucinated).m2).toBe(0);
  });
  it("m4: flags a trivia write mentioning the dog", () => {
    const t = { turn: "T4", toolCalls: [{ name: "memory_write", input: { content: "Ben's dog Rex barked" } }] };
    expect(scoreTurn(t).m4).toBe(1);
    expect(scoreTurn({ turn: "T4", toolCalls: [] }).m4).toBe(0);
  });
  it("m5: credits a durable EnzoError deposit", () => {
    const t = { turn: "T5", toolCalls: [{ name: "knowledge_write", input: { content: "EnzoError type with error code", key: "error-handling-convention" } }] };
    expect(scoreTurn(t).m5).toBe(1);
  });
  it("m3: splits read (m3a) from supersede (m3b)", () => {
    const t = { turn: "T3",
      toolCalls: [{ name: "context_search", input: { query: "desktop" } },
                  { name: "context_write", input: { namespace: "project:enzo", key: "what-we-solve-for", content: "CLI-first now" } }] };
    const s = scoreTurn(t);
    expect(s.m3a).toBe(1);
    expect(s.m3b).toBe("update"); // wrote to the existing key
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `eval/wording-score.mjs`**

```javascript
// eval/wording-score.mjs — deterministic metrics from archived transcripts.
const isWrite = (n) => /_write$/.test(n);
const isRead  = (n) => /_(read|search|browse|backlinks)$/.test(n);
const isDelete = (n) => /_delete$/.test(n);
const argStr  = (c) => JSON.stringify(c.input ?? {}).toLowerCase();

export function scoreTurn(t) {
  const calls = t.toolCalls ?? [];
  const s = {};
  if (t.turn === "T1") s.m1 = t.readBeforeAnswer ? 1 : 0;
  if (t.turn === "T2") {
    const read = calls.some((c) => isRead(c.name));
    const hasDate = /2026-06-05/.test(t.finalText ?? "");
    const otherDate = /\b2026-(?!06-05)\d{2}-\d{2}\b/.test(t.finalText ?? "");
    s.m2 = read && hasDate && !otherDate ? 1 : 0;
  }
  if (t.turn === "T3") {
    s.m3a = calls.some((c) => isRead(c.name) && /desktop|what-we-solve-for|solve/.test(argStr(c))) ? 1 : 0;
    const w = calls.find((c) => isWrite(c.name));
    s.m3b = !w ? "none" : (argStr(w).includes("what-we-solve-for") ? "update" : "duplicate");
  }
  if (t.turn === "T4") s.m4 = calls.some((c) => isWrite(c.name) && /\brex\b|\bdog\b|mailman/.test(argStr(c))) ? 1 : 0;
  if (t.turn === "T5") {
    const w = calls.find((c) => isWrite(c.name) && /enzoerror|error code/.test(argStr(c)));
    s.m5 = w ? 1 : 0;
    s.m8 = calls.filter(isW => isWrite(isW.name)).length
      ? calls.some((c) => /_link$/.test(c.name)) ? 1 : 0 : null;
  }
  if (t.turn === "P3b") {
    s.m6 = calls.some((c) => isWrite(c.name)) ? 1 : 0;
    s.m7a = calls.some((c) => isRead(c.name) && /deploy-smoke|smoke/.test(argStr(c))) ? 1 : 0;
    s.m7b = calls.some((c) => (isDelete(c.name) || isWrite(c.name)) && /deploy-smoke/.test(argStr(c))) ? 1 : 0;
  }
  return s;
}
```

Fix the obvious bug before saving: the m8 line uses a malformed `calls.filter(isW => ...)`. Rewrite it as:
```javascript
const writes = calls.filter((c) => isWrite(c.name));
s.m8 = writes.length ? (calls.some((c) => /_link$/.test(c.name)) ? 1 : 0) : null;
```
(Left in so you read the code. The test for m5 must still pass; add an `m8` assertion if you want coverage.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eval/score.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the aggregator (reads the archive → per-cell rows)**

Append to `eval/wording-score.mjs`:

```javascript
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function* iterArtifacts(root) {
  if (!existsSync(root)) return;
  for (const cond of readdirSync(root))
    for (const model of readdirSync(resolve(root, cond)))
      for (const script of readdirSync(resolve(root, cond, model)))
        for (const f of readdirSync(resolve(root, cond, model, script)))
          yield JSON.parse(readFileSync(resolve(root, cond, model, script, f), "utf-8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, "artifacts");
  const rows = [];
  for (const run of iterArtifacts(root))
    for (const t of run.transcripts)
      rows.push({ condition: run.condition, model: run.model, script: run.scriptId, iter: run.iter, turn: t.turn, ...scoreTurn(t) });
  writeFileSync(resolve(import.meta.dirname, "artifacts/scores.json"), JSON.stringify(rows, null, 2));
  console.log(`scored ${rows.length} turns`);
}
```

- [ ] **Step 6: Commit**

```bash
git add eval/wording-score.mjs tests/eval/score.test.ts
git commit -m "feat(eval): deterministic metrics m1-m8 + aggregator"
```

---

## Milestone 5 — Judge

### Task 10: blinded LLM judge + κ spot-check

**Files:**
- Create: `eval/wording-judge.mjs`
- Test: `tests/eval/judge-parse.test.ts`

**Blinding (spec §6):** the judge sees only the written record (key/type/tags/body) + the P3 manifest — never tool names/descriptions/condition. We extract written records from `*_write` tool-call inputs in the archive and strip everything else.

- [ ] **Step 1: Write the failing test for the pure helpers**

```typescript
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
  it("blinds a record to key/type/tags/body only", () => {
    const b = blindRecord({ namespace: "n", key: "k", content: "body", type: "note", tags: ["a"], extra: "leak" });
    expect(Object.keys(b).sort()).toEqual(["body", "key", "tags", "type"]);
  });
  it("computes Cohen's kappa for perfect agreement = 1", () => {
    expect(cohenKappa([1, 0, 1, 0], [1, 0, 1, 0])).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/judge-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `eval/wording-judge.mjs`**

```javascript
// eval/wording-judge.mjs — blinded record judging (j1-j4) + kappa for the spot-check.
export function extractWrittenRecords(run) {
  const recs = [];
  for (const t of run.transcripts ?? [])
    for (const c of t.toolCalls ?? [])
      if (/_write$/.test(c.name)) recs.push({ turn: t.turn, ...c.input });
  return recs;
}

export function blindRecord(r) {
  return { key: r.key ?? "(derived)", type: r.type ?? "note", tags: r.tags ?? [], body: r.content ?? "" };
}

export function cohenKappa(a, b) {
  const n = a.length;
  let agree = 0; const ca = {}, cb = {};
  for (let i = 0; i < n; i++) { if (a[i] === b[i]) agree++; ca[a[i]] = (ca[a[i]] || 0) + 1; cb[b[i]] = (cb[b[i]] || 0) + 1; }
  const po = agree / n;
  const labels = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  let pe = 0; for (const l of labels) pe += ((ca[l] || 0) / n) * ((cb[l] || 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const JUDGE_SYSTEM =
  "You are scoring records written to a team store. You see only the record (key, type, tags, body) " +
  "and, where relevant, a manifest of what an ideal teammate would have filed. Score: " +
  "(j1) key is concept-oriented not session-oriented [0 or 1]; " +
  "(j2) content class one of durable-shared | episodic-personal | mixed; " +
  "(j3) self-contained for a teammate with no transcript [1-5]; " +
  "(j4, only if a manifest is given) array of manifest item ids this record covers. " +
  'Return ONLY JSON: {"j1":0|1,"j2":"...","j3":1-5,"j4":[...]}. Do not reward verbosity.';

export async function judgeRecord(anthropic, blinded, manifest = null) {
  const user = manifest
    ? `Record:\n${JSON.stringify(blinded, null, 2)}\n\nManifest:\n${JSON.stringify(manifest, null, 2)}`
    : `Record:\n${JSON.stringify(blinded, null, 2)}`;
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 512, temperature: 0,
    system: JUDGE_SYSTEM, messages: [{ role: "user", content: user }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readdirSync, readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic();
  const root = resolve(import.meta.dirname, "artifacts");
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/p3-manifest.json"), "utf-8"));
  const out = [];
  const walk = (d) => existsSync(d) ? readdirSync(d) : [];
  for (const cond of walk(root)) for (const model of walk(resolve(root, cond)))
    for (const script of walk(resolve(root, cond, model)))
      for (const f of walk(resolve(root, cond, model, script))) {
        const run = JSON.parse(readFileSync(resolve(root, cond, model, script, f), "utf-8"));
        for (const r of extractWrittenRecords(run)) {
          const verdict = await judgeRecord(anthropic, blindRecord(r), script === "P3b" ? manifest : null);
          out.push({ condition: cond, model, script, turn: r.turn, verdict });
          process.stdout.write(".");
        }
      }
  writeFileSync(resolve(root, "judgments.json"), JSON.stringify(out, null, 2));
  console.log(`\njudged ${out.length} records`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eval/judge-parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add eval/wording-judge.mjs tests/eval/judge-parse.test.ts
git commit -m "feat(eval): blinded record judge + cohen kappa"
```

---

## Milestone 6 — Analysis + research write-up

### Task 11: Wilson CIs + risk differences → RESULTS.md

**Files:**
- Create: `eval/analysis.mjs`
- Test: `tests/eval/analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/eval/analysis.test.ts
import { describe, expect, it } from "vitest";
import { wilson, riskDifference } from "../../eval/analysis.mjs";

describe("analysis", () => {
  it("wilson CI brackets the point estimate", () => {
    const { lo, hi, p } = wilson(10, 20);
    expect(p).toBeCloseTo(0.5, 5);
    expect(lo).toBeGreaterThan(0.27); expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5); expect(hi).toBeLessThan(0.73);
  });
  it("risk difference reports the gap with a CI", () => {
    const rd = riskDifference({ x: 18, n: 20 }, { x: 6, n: 20 }); // M vs C on m4
    expect(rd.diff).toBeCloseTo(0.6, 5);
    expect(rd.lo).toBeLessThan(0.6); expect(rd.hi).toBeGreaterThan(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/analysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `eval/analysis.mjs`**

```javascript
// eval/analysis.mjs — Wilson score interval + two-proportion risk difference.
export function wilson(x, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 0, n };
  const p = x / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n };
}

// Newcombe risk-difference CI from the two Wilson intervals.
export function riskDifference(a, b, z = 1.96) {
  const wa = wilson(a.x, a.n, z), wb = wilson(b.x, b.n, z);
  const diff = wa.p - wb.p;
  const lo = diff - Math.sqrt((wa.p - wa.lo) ** 2 + (wb.hi - wb.p) ** 2);
  const hi = diff + Math.sqrt((wa.hi - wa.p) ** 2 + (wb.p - wb.lo) ** 2);
  return { diff, lo, hi };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const scores = JSON.parse(readFileSync(resolve(import.meta.dirname, "artifacts/scores.json"), "utf-8"));
  const cell = (cond, metric, turn) => {
    const rows = scores.filter((r) => r.condition === cond && r.turn === turn && r[metric] !== undefined && r[metric] !== null);
    const x = rows.filter((r) => r[metric] === 1).length;
    return { x, n: rows.length };
  };
  // Preregistered primary pairs (spec §8): H1 (M vs C on m4), H2 (M vs C on m1).
  const h1 = riskDifference(cell("M", "m4", "T4"), cell("C", "m4", "T4"));
  const h2 = riskDifference(cell("M", "m1", "T1"), cell("C", "m1", "T1"));
  const md = [
    "# RESULTS — tool-wording experiment",
    "",
    "> Risk differences are the headline; p-values are descriptive (spec §8). " +
    "Null here means 'no large effect detected', NOT equivalence.",
    "",
    "## Preregistered primary",
    `- **H1** (memory stores trivia more than context, m4/T4): RD = ${(h1.diff*100).toFixed(0)}pp [${(h1.lo*100).toFixed(0)}, ${(h1.hi*100).toFixed(0)}]. Predicted ≥ 20pp.`,
    `- **H2** (context reads more at cold start, m1/T1): RD = ${(h2.diff*100).toFixed(0)}pp [${(h2.lo*100).toFixed(0)}, ${(h2.hi*100).toFixed(0)}].`,
    "",
    "## Per-cell rates",
    "_(extend: loop conditions × metrics, print wilson() for each)_",
  ].join("\n");
  writeFileSync(resolve(import.meta.dirname, "../RESULTS.md"), md);
  console.log("wrote RESULTS.md");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eval/analysis.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add eval/analysis.mjs tests/eval/analysis.test.ts
git commit -m "feat(eval): wilson CIs + risk-difference analysis -> RESULTS.md"
```

### Task 12: research write-up (background, before any results)

**Files:**
- Create: `research/memory-rhythms.md`

- [ ] **Step 1: Write `research/memory-rhythms.md`**

Document the PKM background the preregistration rests on (spec §1–§2): the episodic/curated/settled connotations of memory/context/knowledge, the prior art (basic-memory, native auto-memory), and why the predictions H1–H6 follow. This is the companion the spec references; it must exist before results so the hypotheses are demonstrably pre-registered, not back-fit. ~1–2 pages, prose, cite the spec by path.

- [ ] **Step 2: Commit**

```bash
git add research/memory-rhythms.md
git commit -m "docs(research): memory-rhythms background for wording experiment"
```

---

## Milestone 7 — Pilot run + go/no-go

### Task 13: verify model IDs, run the pilot, gate

**Files:** none new — execution + reading results.

- [ ] **Step 1: Verify model IDs against the API**

Use `/claude-api` or the models endpoint to confirm `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, and the current flagship Opus ID. Correct `MODELS` in `eval/wording-run.mjs` if any differ. Do not run on guessed IDs (spec §3).

- [ ] **Step 2: Build, ensure API key, run the pilot**

```bash
npm run build
export ANTHROPIC_API_KEY=...   # if not already set
npm run eval:pilot
```
Expected: 30 runs (M,C × sonnet × P1,P2,P3b × 5), a row of dots, `artifacts/` populated. Provider errors are logged as `[excluded]` and skipped, not fatal.

- [ ] **Step 3: Score, judge, analyze**

```bash
npm run eval:score    # writes artifacts/scores.json
npm run eval:judge    # writes artifacts/judgments.json
npm run eval:analyze  # writes RESULTS.md
```

- [ ] **Step 4: Human review + go/no-go (spec §3, §8)**

- Read 10 pilot transcripts by hand; confirm probes fire as intended and the neutral system prompt leaks no store vocabulary (`grep -iE 'memory|context|knowledge' eval/wording-run.mjs` should hit only the `NEUTRAL_SP` string and condition IDs).
- Spot-check 10% of judgments against your own labels; compute Cohen's κ with `cohenKappa`. If κ < 0.7, fix `JUDGE_SYSTEM` and re-judge before trusting j-metrics.
- **Gate:** clear M-vs-C separation (≳15pp) on m1 or m4 → proceed to fill the `--full` matrix in `wording-run.mjs` per spec §3 and run `eval:full`. Murky (<5pp) → add the Haiku M/C cells first (H5 puts the effect at the small tier) before concluding anything.

- [ ] **Step 5: Commit the pilot results**

```bash
git add RESULTS.md
git commit -m "chore(eval): pilot results + go/no-go verdict"
```

---

## Self-Review

**Spec coverage:**
- §3 conditions M/C/K/N/MxC/CxM → Task 1; PROD → Task 8 (runs real server). ✓
- §3 fresh store per iteration, randomized+logged tool order → Task 8 (`buildSeedDb` per run, `shuffleLogged`). ✓
- §3 model tiers + "verify IDs" → Task 8 `MODELS` + Task 13 Step 1. ✓
- §4 scripts P1/P2/P3b, fresh T1/T2, no store vocab in user turns/history → Tasks 6 (contract test enforces vocab ban), Task 8 (fresh handling). ✓
- §6 metrics m1–m8 incl. m3/m7 split → Task 9. ✓
- §6 blinded judge j1–j4 + κ → Task 10. ✓
- §7 built on existing harness, no MCPJam SDK; optional snapshots → Tasks 7/8 (Anthropic SDK + MCP client), Task 4 (snapshots). ✓
- §8 Wilson CIs + risk differences + "no equivalence" caveat → Task 11. ✓
- §10 deliverables: wrapper+conditions+snapshots (T3/T1/T4), fixtures (T5/T6), harness+score+judge (T7–T10), RESULTS.md (T11), memory-rhythms.md (T12). ✓

**Placeholder scan:** two deliberate, flagged bugs (the `CONatDS` typo in Task 4 and the malformed `m8` filter in Task 9) are intentional read-the-code checks with the fix shown inline — not placeholders. The `--full` matrix is intentionally left to fill *after* the pilot per the spec's allocation-first design; that's a spec requirement (§3), not an omission. RESULTS.md per-cell loop is marked as an extension point with the building block (`wilson()`) provided.

**Type/name consistency:** `scoreTurn`, `runAgentLoop`, `loadConditions`/`VERBS`, `buildSeedDb`, `extractWrittenRecords`/`blindRecord`/`cohenKappa`/`judgeRecord`, `wilson`/`riskDifference`, `SCRIPTS` — each defined once and imported by that exact name in tests and downstream tasks. Metric keys (`m1`,`m2`,`m3a`,`m3b`,`m4`,`m5`,`m6`,`m7a`,`m7b`,`m8`) are consistent between Task 9 and Task 11.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-tool-wording-experiment-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
