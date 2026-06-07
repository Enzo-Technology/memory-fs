# Memory browser — filesystem-tree IA + Foundations grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat three-pane memory browser with a full-viewport app shell — a client-side namespace tree on the left, four lenses on top, a split reading pane that drills to a full-page read, with the address as the route. Pure reads, zero backend change.

**Architecture:** The server stores `namespace` as a flat colon-joined string and lists distinct namespaces with counts; the folder hierarchy is built **client-side** by colon-folding that vocabulary. A pure `buildTree` function does the folding (unit-tested in isolation). A pure `route` module maps `(namespace, key)` ↔ URL path (colons URL-encoded). `useBrowser` v2 holds all state (lens, tree-expansion set, lazy leaf cache, selected address, reader/drill mode, query, route sync); thin presentational components (`TopBar`, `LensRow`, `TreePane`, `Reader`) render it. Only leaf contents are fetched on demand.

**Tech Stack:** React 19 + Vite (esbuild), TypeScript, plain CSS with the existing Foundations tokens. Pure logic tested with Vitest under `tests/`. Server (`browse-api.ts`, `session.ts`, `read`/`recall`) reused **unchanged**.

---

## Conventions & gotchas (read before starting)

- **No backend change in P1.** `src/lib/browse-api.ts`, `src/lib/session.ts`, and the store are reused as-is. The SPA history fallback in `src/lib/auth-ui.ts` already serves `index.html` for any non-asset path, so `/:namespace/:key` deep links route to the browser with no server work.
- **The UI is bundled by esbuild (via Vite), which does _not_ typecheck.** `@types/react`/`@types/react-dom` are **not installed**, so `tsc -p ui/tsconfig.json` floods with false "cannot find react" errors — **do not run it.** The UI verification gate is `npm run build:ui` (catches import/syntax/bundling errors) plus the manual browser smoke test in the final task. Pure-logic modules (`route.ts`, `namespaceTree.ts`) carry real Vitest unit tests because they have no React/DOM dependency.
- **Pure-module tests live under `tests/`** (Vitest's `include` is `tests/**/*.test.ts`) and import across into `ui/src` — type-only imports from `../../src/core/*` are erased at transform time, so this is safe.
- **StrictMode double-invokes effects in dev** — the namespace fetch firing twice on mount is expected and harmless.
- **Address model:** display is colon-joined namespace, then `/`, then key (`voice:onboarding/greeting-tone`). In the URL the colons are `%3A`-encoded. Never invent a title — the first non-empty content line is the title.
- **One surfaced gap (decided):** the spec's mock shows a backlink-count badge (`6↳`) on tree leaves, but the P1 data source for leaves (`browse?kind=recent&namespace=…` → `RecentItem`) carries **no** degree field, and adding one is a backend change P1 forbids. So **P1 tree leaves show the type dot only**; the per-leaf backlink badge is deferred. The **Hubs lens** still shows `in_degree` (it comes on `HubItem`). This is noted again at Task 6.

## File structure

**New pure modules (TDD):**
- `ui/src/route.ts` — `(namespace, key)` ↔ URL path. `tests/route.test.ts`.
- `ui/src/namespaceTree.ts` — flat `{namespace, count}[]` → folder tree by colon-folding. `tests/namespace-tree.test.ts`.

**New / rewritten client units:**
- `ui/src/api.ts` — add `Lens`/`FlatLens` types + `listNamespaces()`; keep `recall`/`readMemory`; retype `listMemories`.
- `ui/src/useBrowser.ts` — rewritten v2 (the deep module).
- `ui/src/TopBar.tsx` — wordmark · search · account.
- `ui/src/LensRow.tsx` — four lenses + running total.
- `ui/src/TreePane.tsx` — disclosure tree + lazy leaves; flat list for Recent/Hubs/Orphans; results for search.
- `ui/src/Reader.tsx` — split + full-page drill via a `mode` prop, one `read` payload.
- `ui/src/Browser.tsx` — composes the four units in the full-viewport shell.
- `ui/src/Dashboard.tsx` — render `Browser` full-viewport (drop the centered card for this surface).
- `ui/src/styles.css` — full-viewport app shell, replacing the old `.browser` grid.

**Deleted:** `ui/src/Facets.tsx`, `ui/src/MemoryList.tsx`, `ui/src/MemoryDetail.tsx`.

---

## Task 1: `route.ts` — address ↔ URL (pure, TDD)

**Files:**
- Create: `ui/src/route.ts`
- Test: `tests/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addressToPath, parseAddress } from "../ui/src/route.js";

describe("route", () => {
  it("encodes namespace colons in the path", () => {
    expect(addressToPath("voice:onboarding", "greeting-tone")).toBe(
      "/voice%3Aonboarding/greeting-tone",
    );
  });

  it("parses a two-segment address and decodes colons", () => {
    expect(parseAddress("/voice%3Aonboarding/greeting-tone")).toEqual({
      namespace: "voice:onboarding",
      key: "greeting-tone",
    });
  });

  it("round-trips", () => {
    const path = addressToPath("a:b:c", "my-key");
    expect(parseAddress(path)).toEqual({ namespace: "a:b:c", key: "my-key" });
  });

  it("returns null for non-address paths (single segment / root)", () => {
    expect(parseAddress("/sign-in")).toBeNull();
    expect(parseAddress("/")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/route.test.ts`
Expected: FAIL — cannot resolve `../ui/src/route.js` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `ui/src/route.ts`:

```ts
// The address IS the route: a memory lives at /:namespace/:key so it is linkable and
// back/forward work. The namespace's structural colons are URL-encoded (%3A) in the path and
// decoded on read, matching the server's decodeURIComponent in /api/memories/:ns/:key. Pure and
// unit-tested — no React, no history side effects (those live in useBrowser).

export function addressToPath(namespace: string, key: string): string {
  return `/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
}

export function parseAddress(
  pathname: string,
): { namespace: string; key: string } | null {
  // Exactly two non-empty segments. Single-segment routes (/sign-in, /consent) and root
  // return null, so the reserved screens never parse as an address.
  const m = pathname.match(/^\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return {
    namespace: decodeURIComponent(m[1]!),
    key: decodeURIComponent(m[2]!),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/route.ts tests/route.test.ts
git commit -m "feat(ui): address-as-route encode/parse helpers"
```

---

## Task 2: `namespaceTree.ts` — colon-folding (pure, TDD)

**Files:**
- Create: `ui/src/namespaceTree.ts`
- Test: `tests/namespace-tree.test.ts`

This is the real logic of the IA: the server has no nested folders, so the hierarchy is derived client-side by splitting each namespace on `:` and folding the segments into a tree. A node can be **both** an intermediate folder and a leaf that owns memories (e.g. `voice` with count 3 *and* children `voice:onboarding`, `voice:errors`).

- [ ] **Step 1: Write the failing test**

Create `tests/namespace-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTree } from "../ui/src/namespaceTree.js";

describe("buildTree", () => {
  it("returns [] for no namespaces", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("makes one node for a colon-free namespace", () => {
    expect(buildTree([{ namespace: "voice", count: 3 }])).toEqual([
      { name: "voice", namespace: "voice", count: 3, total: 3, children: [] },
    ]);
  });

  it("folds shared prefixes into a parent folder, children sorted alpha", () => {
    const tree = buildTree([
      { namespace: "voice:onboarding", count: 12 },
      { namespace: "voice:errors", count: 6 },
    ]);
    expect(tree).toHaveLength(1);
    const voice = tree[0]!;
    expect(voice.namespace).toBe("voice");
    expect(voice.count).toBe(0); // no memories stored at "voice" itself
    expect(voice.total).toBe(18); // sum of descendants
    expect(voice.children.map((c) => c.name)).toEqual(["errors", "onboarding"]);
    expect(voice.children.map((c) => c.count)).toEqual([6, 12]);
  });

  it("lets a node be both a leaf (own count) and a folder (children)", () => {
    const tree = buildTree([
      { namespace: "voice", count: 3 },
      { namespace: "voice:onboarding", count: 12 },
    ]);
    const voice = tree[0]!;
    expect(voice.count).toBe(3);
    expect(voice.total).toBe(15);
    expect(voice.children.map((c) => c.namespace)).toEqual(["voice:onboarding"]);
  });

  it("synthesizes intermediate folders for deep namespaces", () => {
    const tree = buildTree([{ namespace: "a:b:c", count: 4 }]);
    const a = tree[0]!;
    expect(a).toMatchObject({ name: "a", namespace: "a", count: 0, total: 4 });
    const b = a.children[0]!;
    expect(b).toMatchObject({ name: "b", namespace: "a:b", count: 0, total: 4 });
    const c = b.children[0]!;
    expect(c).toMatchObject({ name: "c", namespace: "a:b:c", count: 4, total: 4, children: [] });
  });

  it("sorts top-level nodes alphabetically", () => {
    const tree = buildTree([
      { namespace: "zeta", count: 1 },
      { namespace: "alpha", count: 1 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "zeta"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/namespace-tree.test.ts`
Expected: FAIL — cannot resolve `../ui/src/namespaceTree.js`.

- [ ] **Step 3: Write the implementation**

Create `ui/src/namespaceTree.ts`:

```ts
// The IA's core logic: the server stores `namespace` as a flat colon-joined string and lists
// distinct namespaces with counts; the folder hierarchy is derived HERE by splitting on ':' and
// folding segments into a tree. A node can be both a leaf (own memories, count > 0) and a folder
// (children). Pure — fetched once, cached, rebuilt client-side; unit-tested in isolation.
import type { NamespaceItem } from "../../src/core/store";

export interface TreeNode {
  name: string; // the last segment, e.g. "onboarding"
  namespace: string; // full colon-joined path, e.g. "voice:onboarding"
  count: number; // memories stored EXACTLY at this namespace (0 if purely a folder)
  total: number; // count + every descendant's count (the folder badge)
  children: TreeNode[]; // child folders, sorted alphabetically
}

export function buildTree(items: NamespaceItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  // Find-or-create the node for a segment path, wiring it under its parent (recursively
  // synthesizing intermediate folders that have no memories of their own).
  const ensure = (segments: string[]): TreeNode => {
    const path = segments.join(":");
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: TreeNode = {
      name: segments[segments.length - 1]!,
      namespace: path,
      count: 0,
      total: 0,
      children: [],
    };
    byPath.set(path, node);
    if (segments.length === 1) roots.push(node);
    else ensure(segments.slice(0, -1)).children.push(node);
    return node;
  };

  for (const item of items) ensure(item.namespace.split(":")).count = item.count;

  // Sort children alphabetically and roll up totals bottom-up.
  const finalize = (node: TreeNode): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.total =
      node.count + node.children.reduce((sum, c) => sum + finalize(c), 0);
    return node.total;
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of roots) finalize(r);

  return roots;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/namespace-tree.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/namespaceTree.ts tests/namespace-tree.test.ts
git commit -m "feat(ui): client-side namespace tree by colon-folding"
```

---

## Task 3: `api.ts` — lens types + namespace-list fetch

**Files:**
- Modify: `ui/src/api.ts`

The data layer gains `listNamespaces()` (returns items **and** the store-wide total, which powers the running total) and the `Lens`/`FlatLens` types. `listMemories` is retyped to the three flat lenses (it is also reused to fetch a folder's leaves via `kind=recent`).

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `ui/src/api.ts` with:

```ts
// The data layer: the only place that knows endpoint URLs and that the cookie must travel
// (credentials: "include"). Response shapes are imported (type-only) from the server's store
// types — never re-declared here — so the only client↔server coupling is the URL strings.
import type { BrowseResult, NamespaceItem, ReadResult } from "../../src/core/store";
import type { Memory } from "../../src/core/db";

// The flat lenses that resolve to openable memory rows (used both as a top-level lens and, with a
// namespace, to fetch one folder's leaves). "namespaces" is the tree and is fetched separately.
export type FlatLens = "recent" | "hubs" | "orphans";
export type Lens = "namespaces" | FlatLens;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  // The API 401s when the session is absent/expired; bounce to sign-in (private surface).
  if (res.status === 401) {
    location.href = "/sign-in";
    throw new Error("unauthenticated");
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// The namespace vocabulary, fetched once and folded into the tree client-side. Returns the
// store-wide memory `total` alongside, so the running total needs no extra call. Limit is raised
// past the store default (20) so the tree shows every namespace.
export async function listNamespaces(): Promise<{
  items: NamespaceItem[];
  total: number;
}> {
  const b = await get<BrowseResult>(`/api/memories?kind=namespaces&limit=1000`);
  if (b.kind !== "namespaces") throw new Error("expected namespaces result");
  return { items: b.items, total: b.total };
}

export function listMemories(kind: FlatLens, namespace?: string): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind, limit: "100" });
  if (namespace) p.set("namespace", namespace);
  return get<BrowseResult>(`/api/memories?${p.toString()}`);
}

export function recall(query: string): Promise<Memory[]> {
  return get<Memory[]>(`/api/memories/recall?q=${encodeURIComponent(query)}`);
}

export function readMemory(namespace: string, key: string): Promise<ReadResult> {
  return get<ReadResult>(
    `/api/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
  );
}
```

- [ ] **Step 2: Verify it bundles**

Run: `npm run build:ui`
Expected: build succeeds (the build still references the old `Facet` type via the not-yet-deleted components — if it errors on a missing `Facet` import, that's expected and resolved in Task 8; at this point the build may fail on `Facets.tsx`/`MemoryList.tsx`/`useBrowser.ts` importing `Facet`. **Do not fix those here** — proceed; they are rewritten/deleted in Tasks 4 and 8.)

> Note: because Tasks 3–8 rewrite an interlocking set of files, the UI build is only expected to be green again at **Task 8**. Each intermediate task still commits (small, reviewable steps); the green-build gate is the end of Task 8.

- [ ] **Step 3: Commit**

```bash
git add ui/src/api.ts
git commit -m "feat(ui): typed namespace-list fetch + lens types"
```

---

## Task 4: `useBrowser.ts` v2 — the state machine

**Files:**
- Modify (full rewrite): `ui/src/useBrowser.ts`

Holds every piece of browser state and the route side effects; renders nothing. The panes are thin over it.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `ui/src/useBrowser.ts` with:

```ts
// All browser state + orchestration: active lens, search query, the namespace tree and which
// folders are open, lazily-fetched folder contents, the selected address, the reader/drill mode,
// and URL <-> selection sync. Renders nothing — hands a view-model + actions to the panes. The
// deep module; the panes are thin over it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listMemories,
  listNamespaces,
  readMemory,
  recall,
  type FlatLens,
  type Lens,
} from "./api";
import type { BrowseResult, ReadResult } from "../../src/core/store";
import type { MemoryType } from "../../src/core/db";
import { buildTree, type TreeNode } from "./namespaceTree";
import { addressToPath, parseAddress } from "./route";

export interface Row {
  namespace: string;
  key: string;
  type: MemoryType;
  snippet: string;
  metric?: number; // Hubs lens: in_degree, rendered as "N↳"
}

export type Mode = "split" | "drill";

export interface BrowserView {
  lens: Lens;
  query: string;
  tree: TreeNode[] | null; // null while the namespace vocabulary loads
  expanded: Set<string>; // namespaces of open folders/leaf-folders
  leaves: Record<string, Row[]>; // resolved folder contents, keyed by namespace
  flat: Row[] | null; // Recent/Hubs/Orphans list; null while loading
  results: Row[] | null; // search results; non-null only while a query is active
  detail: ReadResult | null;
  selected: { namespace: string; key: string } | null;
  mode: Mode;
  totals: { memories: number; namespaces: number };
  selectLens: (l: Lens) => void;
  setQuery: (q: string) => void;
  toggleFolder: (node: TreeNode) => void;
  expandAll: () => void;
  open: (namespace: string, key: string) => void;
  drill: () => void;
  showTree: () => void;
}

// First non-empty line of content — the de-facto title/snippet (the store never stores a title).
function firstLine(content: string): string {
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

// Map a flat browse result to openable rows. Hubs carry in_degree as the metric.
function toRows(b: BrowseResult): Row[] {
  if (b.kind === "recent" || b.kind === "orphans") {
    return b.items.map((m) => ({
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      snippet: m.snippet,
    }));
  }
  if (b.kind === "hubs") {
    return b.items.map((m) => ({
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      snippet: m.snippet,
      metric: m.in_degree,
    }));
  }
  return [];
}

export function useBrowser(): BrowserView {
  const [lens, setLens] = useState<Lens>("namespaces");
  const [query, setQuery] = useState("");
  const [namespaceItems, setNamespaceItems] = useState<
    { namespace: string; count: number }[] | null
  >(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [leaves, setLeaves] = useState<Record<string, Row[]>>({});
  const [flat, setFlat] = useState<Row[] | null>(null);
  const [results, setResults] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<{ namespace: string; key: string } | null>(
    () => parseAddress(location.pathname),
  );
  const [detail, setDetail] = useState<ReadResult | null>(null);
  const [mode, setMode] = useState<Mode>("split");
  const [totals, setTotals] = useState({ memories: 0, namespaces: 0 });
  const inflight = useRef<Set<string>>(new Set());

  const tree = useMemo(
    () => (namespaceItems ? buildTree(namespaceItems) : null),
    [namespaceItems],
  );

  // 1. Namespace vocabulary — fetched once; powers the tree + the running total.
  useEffect(() => {
    let live = true;
    listNamespaces().then(({ items, total }) => {
      if (!live) return;
      setNamespaceItems(items);
      setTotals({ memories: total, namespaces: items.length });
    });
    return () => {
      live = false;
    };
  }, []);

  // 2. Flat lens list (Recent/Hubs/Orphans). Skipped for the tree lens and while searching.
  useEffect(() => {
    if (query.trim() || lens === "namespaces") {
      setFlat(null);
      return;
    }
    let live = true;
    setFlat(null);
    listMemories(lens as FlatLens).then((b) => {
      if (!live) return;
      setFlat(toRows(b));
      setTotals((t) => ({ ...t, memories: b.total }));
    });
    return () => {
      live = false;
    };
  }, [lens, query]);

  // 3. Search — a non-empty query populates the results list via recall.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let live = true;
    recall(q).then((ms) => {
      if (!live) return;
      setResults(
        ms.map((m) => ({
          namespace: m.namespace,
          key: m.key,
          type: m.type,
          snippet: firstLine(m.content).slice(0, 140),
        })),
      );
    });
    return () => {
      live = false;
    };
  }, [query]);

  // 4. Detail for the selected address.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    readMemory(selected.namespace, selected.key).then((d) => {
      if (live) setDetail(d);
    });
    return () => {
      live = false;
    };
  }, [selected]);

  // 5. Back/forward → re-read the address from the URL (no pushState here, or we'd loop).
  useEffect(() => {
    const onPop = () => setSelected(parseAddress(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Lazy-fetch one folder's own memories the first time it opens. Guards against duplicate
  // fetches (already resolved OR in flight). Derive-don't-round-trip: only leaf contents hit
  // the network; the folder structure is all client-side.
  const ensureLeaf = useCallback((ns: string) => {
    setLeaves((cur) => {
      if (ns in cur || inflight.current.has(ns)) return cur;
      inflight.current.add(ns);
      listMemories("recent", ns)
        .then((b) => setLeaves((c) => ({ ...c, [ns]: toRows(b) })))
        .finally(() => inflight.current.delete(ns));
      return cur;
    });
  }, []);

  const toggleFolder = useCallback(
    (node: TreeNode) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(node.namespace)) next.delete(node.namespace);
        else next.add(node.namespace);
        return next;
      });
      if (node.count > 0) ensureLeaf(node.namespace);
    },
    [ensureLeaf],
  );

  const expandAll = useCallback(() => {
    if (!tree) return;
    const all = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length || n.count > 0) all.add(n.namespace);
        if (n.count > 0) ensureLeaf(n.namespace);
        walk(n.children);
      }
    };
    walk(tree);
    setExpanded(all);
  }, [tree, ensureLeaf]);

  const open = useCallback((namespace: string, key: string) => {
    setSelected({ namespace, key });
    history.pushState(null, "", addressToPath(namespace, key));
  }, []);

  const selectLens = useCallback((l: Lens) => {
    setQuery("");
    setLens(l);
  }, []);

  return {
    lens,
    query,
    tree,
    expanded,
    leaves,
    flat,
    results,
    detail,
    selected,
    mode,
    totals,
    selectLens,
    setQuery,
    toggleFolder,
    expandAll,
    open,
    drill: useCallback(() => setMode("drill"), []),
    showTree: useCallback(() => setMode("split"), []),
  };
}
```

- [ ] **Step 2: Commit**

(The UI build is not yet green — `Browser.tsx`/`Facets.tsx`/`MemoryList.tsx` still reference the old API. They are rewritten/deleted in Task 8. Commit the state machine now as a reviewable unit.)

```bash
git add ui/src/useBrowser.ts
git commit -m "feat(ui): useBrowser v2 — tree, lazy leaves, mode, route sync"
```

---

## Task 5: `TopBar.tsx` + `LensRow.tsx`

**Files:**
- Create: `ui/src/TopBar.tsx`
- Create: `ui/src/LensRow.tsx`

- [ ] **Step 1: Create `TopBar.tsx`**

```tsx
// The 60px top bar: wordmark, the wide global search field (full-text recall — NOT a tree
// filter; the ⌘K palette treatment is P2), and the account. Props in, events out.
// Styling: .topbar.
export function TopBar({
  query,
  onQuery,
  email,
  onSignOut,
}: {
  query: string;
  onQuery: (q: string) => void;
  email: string;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <span className="topbar__wordmark">memory-fs</span>
      <input
        className="topbar__search"
        value={query}
        placeholder="Search memories…"
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="topbar__account">
        <span className="topbar__email">{email}</span>
        <button className="topbar__signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create `LensRow.tsx`**

```tsx
// The 50px lens row: the four P1 lenses (Tags is P2) and the running total pinned right. Selecting
// a lens swaps what populates the tree pane; it never changes the layout. Props only.
// Styling: .lensrow / .lens.
import type { Lens } from "./api";

const LENSES: { id: Lens; label: string }[] = [
  { id: "namespaces", label: "Namespaces" },
  { id: "recent", label: "Recent" },
  { id: "hubs", label: "Hubs" },
  { id: "orphans", label: "Orphans" },
];

export function LensRow({
  active,
  onSelect,
  totals,
}: {
  active: Lens;
  onSelect: (l: Lens) => void;
  totals: { memories: number; namespaces: number };
}) {
  return (
    <nav className="lensrow">
      <div className="lensrow__lenses">
        {LENSES.map((l) => (
          <button
            key={l.id}
            className={l.id === active ? "lens lens--active" : "lens"}
            onClick={() => onSelect(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <span className="lensrow__total">
        {totals.memories} memories · {totals.namespaces} namespaces
      </span>
    </nav>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/TopBar.tsx ui/src/LensRow.tsx
git commit -m "feat(ui): TopBar (search) + LensRow (four lenses + total)"
```

---

## Task 6: `TreePane.tsx` — disclosure tree, lazy leaves, flat/search lists

**Files:**
- Create: `ui/src/TreePane.tsx`

Renders one of three things depending on state: search results (when a query is active), the namespace tree (Namespaces lens), or a flat list (Recent/Hubs/Orphans). Folders disclose; multiple branches stay open; leaf-folder contents lazy-load with a quiet skeleton.

> **Surfaced gap (decided):** tree leaves show the **type dot only** — the per-leaf backlink badge (`6↳`) from the mock needs a degree field on the recent payload, which is a backend change P1 forbids. The Hubs lens flat rows still render `in_degree` as `N↳` (it ships on `HubItem`).

- [ ] **Step 1: Create `TreePane.tsx`**

```tsx
// The left pane. Three render modes, chosen by state: search results > flat lens list > the
// namespace tree. Finder-style disclosure (multiple branches open at once); leaf-folder contents
// lazy-load with a quiet skeleton. Leaves show a type dot only (per-leaf backlink count is P2 —
// the recent payload carries no degree and P1 adds no backend). Props only.
// Styling: .tree / .trow / .mrow.
import type { Lens } from "./api";
import type { TreeNode } from "./namespaceTree";
import type { Row } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";

type Selected = { namespace: string; key: string } | null;

function paneTitle(lens: Lens, query: string): string {
  if (query.trim()) return "Results";
  return { namespaces: "Namespaces", recent: "Recent", hubs: "Hubs", orphans: "Orphans" }[lens];
}

function emptyLensMessage(lens: Lens): string {
  if (lens === "orphans") return "No orphans — everything here is linked.";
  if (lens === "hubs") return "No hubs yet — nothing is linked to.";
  return "Nothing here yet.";
}

export function TreePane({
  lens,
  query,
  tree,
  expanded,
  leaves,
  flat,
  results,
  selected,
  onToggle,
  onOpen,
  onExpandAll,
}: {
  lens: Lens;
  query: string;
  tree: TreeNode[] | null;
  expanded: Set<string>;
  leaves: Record<string, Row[]>;
  flat: Row[] | null;
  results: Row[] | null;
  selected: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
  onExpandAll: () => void;
}) {
  return (
    <aside className="tree">
      <div className="tree__header">
        <span className="tree__title">{paneTitle(lens, query)}</span>
        {lens === "namespaces" && !query.trim() && (
          <button className="tree__expand" onClick={onExpandAll}>
            expand all
          </button>
        )}
      </div>
      <div className="tree__body">
        {renderBody({ lens, query, tree, expanded, leaves, flat, results, selected, onToggle, onOpen })}
      </div>
    </aside>
  );
}

function renderBody(p: {
  lens: Lens;
  query: string;
  tree: TreeNode[] | null;
  expanded: Set<string>;
  leaves: Record<string, Row[]>;
  flat: Row[] | null;
  results: Row[] | null;
  selected: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
}) {
  // Search results take precedence whenever a query is active.
  if (p.query.trim()) {
    if (!p.results) return <div className="tree__skeleton">…</div>;
    if (p.results.length === 0)
      return <p className="tree__empty">No matches. Try a broader term.</p>;
    return p.results.map((r) => (
      <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
    ));
  }

  // The tree lens.
  if (p.lens === "namespaces") {
    if (!p.tree) return <div className="tree__skeleton">…</div>;
    if (p.tree.length === 0)
      return <p className="tree__empty">Agents haven&apos;t written anything here yet.</p>;
    return p.tree.map((n) => (
      <FolderRow
        key={n.namespace}
        node={n}
        depth={0}
        expanded={p.expanded}
        leaves={p.leaves}
        selected={p.selected}
        onToggle={p.onToggle}
        onOpen={p.onOpen}
      />
    ));
  }

  // A flat lens (Recent / Hubs / Orphans).
  if (!p.flat) return <div className="tree__skeleton">…</div>;
  if (p.flat.length === 0) return <p className="tree__empty">{emptyLensMessage(p.lens)}</p>;
  return p.flat.map((r) => (
    <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
  ));
}

// A folder (and, when open, its child folders then its own memory leaves). Indent is 20px/depth.
function FolderRow({
  node,
  depth,
  expanded,
  leaves,
  selected,
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  leaves: Record<string, Row[]>;
  selected: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
}) {
  const isOpen = expanded.has(node.namespace);
  const expandable = node.children.length > 0 || node.count > 0;
  const indent = { paddingLeft: 8 + depth * 20 };
  const childIndent = { paddingLeft: 8 + (depth + 1) * 20 };
  return (
    <>
      <button className="trow trow--folder" style={indent} onClick={() => onToggle(node)}>
        <span className={isOpen ? "chev chev--open" : "chev"}>{expandable ? "▸" : ""}</span>
        <span className="trow__name">{node.name}</span>
        <span className="trow__count">{node.total}</span>
      </button>
      {isOpen && (
        <>
          {node.children.map((c) => (
            <FolderRow
              key={c.namespace}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              leaves={leaves}
              selected={selected}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
          {node.count > 0 &&
            (node.namespace in leaves ? (
              leaves[node.namespace]!.map((r) => (
                <LeafRow
                  key={`${r.namespace}/${r.key}`}
                  row={r}
                  indent={childIndent}
                  selected={selected}
                  onOpen={onOpen}
                />
              ))
            ) : (
              <div className="trow trow--skeleton" style={childIndent}>
                …
              </div>
            ))}
        </>
      )}
    </>
  );
}

// A memory inside the tree: type dot + key. Active when it is the selected address.
function LeafRow({
  row,
  indent,
  selected,
  onOpen,
}: {
  row: Row;
  indent: { paddingLeft: number };
  selected: Selected;
  onOpen: (namespace: string, key: string) => void;
}) {
  const active = !!selected && selected.namespace === row.namespace && selected.key === row.key;
  return (
    <button
      className={active ? "trow trow--leaf trow--active" : "trow trow--leaf"}
      style={indent}
      onClick={() => onOpen(row.namespace, row.key)}
    >
      <span className="tdot" style={{ background: TYPE_COLOR[row.type].fg }} />
      <span className="trow__key">{row.key}</span>
    </button>
  );
}

// A full memory row for the flat/search lists: address + optional metric + type dot, then snippet.
function MemoryRow({
  row,
  selected,
  onOpen,
}: {
  row: Row;
  selected: Selected;
  onOpen: (namespace: string, key: string) => void;
}) {
  const active = !!selected && selected.namespace === row.namespace && selected.key === row.key;
  return (
    <button
      className={active ? "mrow mrow--active" : "mrow"}
      onClick={() => onOpen(row.namespace, row.key)}
    >
      <div className="mrow__head">
        <span className="addr">
          <span className="addr__ns">{row.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{row.key}</span>
        </span>
        {row.metric !== undefined && <span className="mrow__metric">{row.metric}↳</span>}
        <span className="tdot" style={{ background: TYPE_COLOR[row.type].fg }} />
      </div>
      <span className="mrow__snippet">{row.snippet}</span>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/TreePane.tsx
git commit -m "feat(ui): TreePane — disclosure tree, lazy leaves, flat/search lists"
```

---

## Task 7: `Reader.tsx` — split + full-page drill

**Files:**
- Create: `ui/src/Reader.tsx`

One component, two layouts via a `mode` prop sharing a single `read` payload. Split is the home reading pane; drill is the centered focus view that gains neighbour snippets. Reversible: `show tree` returns to split with the same memory selected.

- [ ] **Step 1: Create `Reader.tsx`**

```tsx
// The reading pane. Split (home) and drill (full-page focus) are one component switched by `mode`,
// sharing the single `read` payload (memory + depth-1 children/backlinks with snippets — no extra
// fetch). Title is the first content line (never invented). In drill, neighbours gain snippets.
// Props only. Styling: .reader.
import type { ReadResult } from "../../src/core/store";
import type { Mode } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";

function firstLine(content: string): string {
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

export function Reader({
  detail,
  mode,
  empty,
  onNavigate,
  onDrill,
  onShowTree,
}: {
  detail: ReadResult | null;
  mode: Mode;
  empty: string;
  onNavigate: (namespace: string, key: string) => void;
  onDrill: () => void;
  onShowTree: () => void;
}) {
  if (!detail) {
    return (
      <section className="reader reader--empty">
        <p>{empty}</p>
      </section>
    );
  }
  const color = TYPE_COLOR[detail.type];
  const title = firstLine(detail.content) || detail.key;
  const drilled = mode === "drill";
  return (
    <section className={drilled ? "reader reader--drill" : "reader"}>
      <div className="reader__bar">
        <span className="addr">
          <span className="addr__ns">{detail.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{detail.key}</span>
        </span>
        {drilled ? (
          <button className="reader__toggle" onClick={onShowTree}>
            show tree
          </button>
        ) : (
          <button className="reader__toggle" onClick={onDrill}>
            focus
          </button>
        )}
      </div>
      <article className="reader__doc">
        <span className="chip" style={{ color: color.fg, background: color.bg }}>
          <span className="cdot" style={{ background: color.fg }} />
          {detail.type}
        </span>
        <h1 className="reader__title">{title}</h1>
        <pre className="reader__content">{detail.content}</pre>
        {(detail.children.length > 0 || detail.backlinks.length > 0) && (
          <div className="reader__rel">
            <Neighbours
              title="Links out"
              items={detail.children}
              withSnippet={drilled}
              onNavigate={onNavigate}
            />
            <Neighbours
              title="Backlinks"
              items={detail.backlinks}
              withSnippet={drilled}
              onNavigate={onNavigate}
            />
          </div>
        )}
        {detail.tags.length > 0 && (
          <div className="reader__tags">
            {detail.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function Neighbours({
  title,
  items,
  withSnippet,
  onNavigate,
}: {
  title: string;
  items: ReadResult["children"];
  withSnippet: boolean;
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="neighbours">
      <em>
        {title} · {items.length}
      </em>
      {items.map((n) => (
        <button
          key={`${n.namespace}/${n.key}`}
          className="neighbour"
          onClick={() => onNavigate(n.namespace, n.key)}
        >
          <span className="neighbour__addr">
            {n.namespace}/{n.key}
          </span>
          {withSnippet && <span className="neighbour__snippet">{n.snippet}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/Reader.tsx
git commit -m "feat(ui): Reader — split + full-page drill sharing one read payload"
```

---

## Task 8: Compose `Browser.tsx`, rewire `Dashboard.tsx`, delete old panes

**Files:**
- Modify (full rewrite): `ui/src/Browser.tsx`
- Modify: `ui/src/Dashboard.tsx`
- Delete: `ui/src/Facets.tsx`, `ui/src/MemoryList.tsx`, `ui/src/MemoryDetail.tsx`

- [ ] **Step 1: Rewrite `Browser.tsx`**

Replace the entire contents of `ui/src/Browser.tsx` with:

```tsx
// The composer: calls useBrowser and wires its view-model + actions into the full-viewport shell
// (top bar / lens row / body split). In drill mode the tree is unmounted and the reader becomes a
// single centered column. No logic of its own — derived props belong in useBrowser. Styling: .app.
import { useBrowser } from "./useBrowser";
import { TopBar } from "./TopBar";
import { LensRow } from "./LensRow";
import { TreePane } from "./TreePane";
import { Reader } from "./Reader";

export function Browser({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const vm = useBrowser();
  const drilled = vm.mode === "drill";
  const emptyReader =
    vm.totals.memories === 0
      ? "Agents haven't written anything here yet."
      : "Select a memory.";
  return (
    <div className={drilled ? "app app--drill" : "app"}>
      <TopBar query={vm.query} onQuery={vm.setQuery} email={email} onSignOut={onSignOut} />
      <LensRow active={vm.lens} onSelect={vm.selectLens} totals={vm.totals} />
      <div className="app__body">
        {!drilled && (
          <TreePane
            lens={vm.lens}
            query={vm.query}
            tree={vm.tree}
            expanded={vm.expanded}
            leaves={vm.leaves}
            flat={vm.flat}
            results={vm.results}
            selected={vm.selected}
            onToggle={vm.toggleFolder}
            onOpen={vm.open}
            onExpandAll={vm.expandAll}
          />
        )}
        <Reader
          detail={vm.detail}
          mode={vm.mode}
          empty={emptyReader}
          onNavigate={vm.open}
          onDrill={vm.drill}
          onShowTree={vm.showTree}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewire `Dashboard.tsx`**

Replace the entire contents of `ui/src/Dashboard.tsx` with (the browser is full-viewport now — no centered `Shell` card, and the account/sign-out moves into `TopBar`):

```tsx
import { useEffect } from "react";
import { authClient } from "./auth";
import { Shell } from "./Shell";
import { Browser } from "./Browser";

// The session-gated app home: the full-viewport memory browser. Anything that isn't /sign-in,
// /sign-up, or /consent lands here — including /:namespace/:key deep links, which the browser
// reads off the URL. The auth screens still use the centered Shell; the browser does not.
export function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  // No session → this is a private surface, send them to sign in.
  useEffect(() => {
    if (!isPending && !session) location.href = "/sign-in";
  }, [isPending, session]);

  if (isPending || !session)
    return (
      <Shell>
        <p>…</p>
      </Shell>
    );

  return (
    <Browser
      email={session.user.email}
      onSignOut={() => authClient.signOut().then(() => location.reload())}
    />
  );
}
```

- [ ] **Step 3: Delete the superseded panes**

```bash
git rm ui/src/Facets.tsx ui/src/MemoryList.tsx ui/src/MemoryDetail.tsx
```

- [ ] **Step 4: Verify the UI bundles green**

Run: `npm run build:ui`
Expected: build succeeds with no unresolved-import errors. (This is the green-build gate — the interlocking rewrite from Tasks 3–8 is now consistent.)

- [ ] **Step 5: Verify server tests still pass (no backend change)**

Run: `npx vitest run`
Expected: PASS — the 54 server tests plus the new `route` (4) and `namespace-tree` (6) tests, all green.

- [ ] **Step 6: Commit**

```bash
git add ui/src/Browser.tsx ui/src/Dashboard.tsx
git commit -m "feat(ui): compose full-viewport browser; retire Facets/MemoryList/MemoryDetail"
```

---

## Task 9: `styles.css` — full-viewport app shell

**Files:**
- Modify: `ui/src/styles.css`

Replace the old centered `.browser` grid (and the now-unused `.dashboard-bar`) with the 100vh flex column: 60px top bar, 50px lens row, then the `340px 1fr` body that collapses to `1fr` in drill. Keeps every existing token; reuses the address/type-dot/chip atoms. Measurements from the spec: tree row 32px, pane headers 46px, indent 20px/depth, reading measure 62ch split / 680px drill.

- [ ] **Step 1: Replace from the dashboard-bar section to end of file**

In `ui/src/styles.css`, replace everything from the line `/* ---------- dashboard bar ---------- */` through the end of the file with:

```css
/* ---------- full-viewport app ---------- */
html,
body,
#root {
  height: 100%;
}
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}

/* top bar (60px) */
.topbar {
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  gap: var(--s-5);
  padding: 0 var(--s-5);
  border-bottom: 1px solid var(--hairline);
}
.topbar__wordmark {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.topbar__search {
  flex: 1;
  max-width: 520px;
  height: 36px;
  border: 1px solid var(--hairline-2);
  border-radius: var(--r-md);
  background: var(--surface);
  padding: 0 14px;
  font: inherit;
  font-size: 14px;
  color: var(--ink);
}
.topbar__search::placeholder {
  color: var(--ink-4);
}
.topbar__account {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-size: 13px;
  color: var(--ink-3);
}
.topbar__email {
  color: var(--ink-2);
}
.topbar__signout {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: 1px solid #bfd3be;
  border-radius: var(--r-sm);
  padding: 6px 12px;
}

/* lens row (50px) */
.lensrow {
  flex: 0 0 50px;
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding: 0 var(--s-5);
  border-bottom: 1px solid var(--hairline);
}
.lensrow__lenses {
  display: flex;
  gap: var(--s-1);
}
.lens {
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-3);
  padding: 6px 13px;
  border-radius: var(--r-pill);
}
.lens:hover {
  background: var(--fill);
  color: var(--ink-2);
}
.lens--active {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}
.lensrow__total {
  margin-left: auto;
  font-size: 13px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

/* body split: 340px tree + reader; collapses to one column in drill */
.app__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 340px 1fr;
}
.app--drill .app__body {
  grid-template-columns: 1fr;
}

/* ---------- tree pane ---------- */
.tree {
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tree__header {
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--s-4);
  border-bottom: 1px solid var(--hairline);
}
.tree__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.tree__expand {
  background: none;
  border: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.tree__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s-2) 0;
}
.tree__empty {
  padding: var(--s-5) var(--s-4);
  font-size: 13px;
  color: var(--ink-3);
  line-height: 1.6;
}
.tree__skeleton {
  padding: var(--s-4);
  color: var(--ink-4);
}

/* tree rows (folders + leaves): 32px, 20px indent/depth */
.trow {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  background: none;
  border: none;
  text-align: left;
  padding: 0 var(--s-4);
  font-size: 13.5px;
  color: var(--ink-2);
}
.trow:hover {
  background: #f4f2eb;
}
.trow--active {
  background: var(--accent-soft);
}
.chev {
  width: 12px;
  flex: 0 0 auto;
  color: var(--ink-4);
  font-size: 9px;
  transition: transform 0.12s ease;
}
.chev--open {
  transform: rotate(90deg);
  color: var(--ink-3);
}
.trow__name {
  font-weight: 600;
  color: var(--ink);
}
.trow__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.trow--leaf .trow__key {
  color: var(--ink-2);
  font-weight: 500;
}
.trow--active .trow__key {
  color: var(--accent-ink);
}
.trow--skeleton {
  color: var(--ink-4);
}

/* ---------- flat / search memory rows ---------- */
.mrow {
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  padding: 12px var(--s-4);
  display: grid;
  gap: var(--s-2);
}
.mrow:hover {
  background: #f4f2eb;
}
.mrow--active {
  background: var(--accent-soft);
}
.mrow__head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.mrow__metric {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.mrow__snippet {
  font-size: 13px;
  color: var(--ink-3);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- shared atoms ---------- */
.addr {
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.addr__ns {
  color: var(--accent);
  font-weight: 600;
}
.addr__sep {
  color: var(--ink-4);
  margin: 0 2px;
}
.addr__key {
  color: var(--ink-2);
  font-weight: 500;
}
.tdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.mrow__head .tdot {
  margin-left: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 11px;
  border-radius: var(--r-pill);
  align-self: flex-start;
}
.cdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* ---------- reading pane ---------- */
.reader {
  min-height: 0;
  overflow-y: auto;
  background: var(--surface);
  display: flex;
  flex-direction: column;
}
.reader--empty {
  align-items: center;
  justify-content: center;
  color: var(--ink-4);
}
.reader__bar {
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--s-5);
  border-bottom: 1px solid var(--hairline);
}
.reader__toggle {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
.reader__doc {
  padding: var(--s-6) var(--s-7);
  display: grid;
  gap: var(--s-5);
  align-content: start;
}
.reader__title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.14;
  margin: 0;
}
.reader__content {
  white-space: pre-wrap;
  margin: 0;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-2);
  max-width: 62ch;
}

/* drill: one centered ~680px column, larger body */
.reader--drill .reader__doc {
  max-width: 680px;
  margin: 0 auto;
}
.reader--drill .reader__title {
  font-size: 34px;
}
.reader--drill .reader__content {
  font-size: 17px;
  line-height: 1.75;
  max-width: none;
}

/* related: two columns, hairline top */
.reader__rel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-7);
  padding-top: var(--s-5);
  border-top: 1px solid var(--hairline);
  max-width: 62ch;
}
.reader--drill .reader__rel {
  max-width: none;
}
.neighbours {
  display: grid;
  gap: var(--s-2);
  align-content: start;
}
.neighbours > em {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.neighbour {
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--hairline);
  padding: 7px 0;
  display: grid;
  gap: 2px;
}
.neighbour__addr {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
}
.neighbour:hover .neighbour__addr {
  color: var(--accent-ink);
}
.neighbour__snippet {
  font-size: 12.5px;
  color: var(--ink-3);
}

/* tags */
.reader__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.tag {
  font-size: 12px;
  color: var(--ink-3);
  background: var(--fill);
  padding: 3px 9px;
  border-radius: var(--r-pill);
}
```

- [ ] **Step 2: Verify it bundles**

Run: `npm run build:ui`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add ui/src/styles.css
git commit -m "feat(ui): full-viewport app shell styles (grid + spacing)"
```

---

## Task 10: Full build + manual verification

Pure logic is unit-tested; the components are verified by building and driving the real app (no React test harness exists in this repo, and the spec scopes unit testing to the pure `namespaceTree` — adding jsdom/testing-library is out of scope). This task is the human-in-the-loop smoke test against a real store.

- [ ] **Step 1: Full build (UI bundle + server typecheck)**

Run: `npm run build`
Expected: `vite build ui` succeeds AND `tsc` (server, `src/**`) succeeds with no errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all green — server suite (54) + `route` (4) + `namespace-tree` (6).

- [ ] **Step 3: Run the app against a store with data**

Run: `npm run dev` (serves the built UI same-origin with `/api/auth` and `/api/memories`). Sign in, then walk this checklist in the browser:

- [ ] **Namespaces lens (default):** the tree renders with folder counts; a namespace containing `:` (e.g. `voice:onboarding`) appears nested under its parent (`voice`); the running total reads `N memories · M namespaces`.
- [ ] **Lazy leaves:** opening a folder with its own memories briefly shows the `…` skeleton, then the memory leaves (type dot + key); multiple branches stay open at once; `expand all` opens everything.
- [ ] **Open + split read:** clicking a leaf fills the reading pane (address breadcrumb · type pill · first-line title · body · Links out / Backlinks · tags); the URL becomes `/<ns%3A…>/<key>`.
- [ ] **Drill + back:** `focus` collapses the tree to a centered ~680px column with larger body and neighbour snippets; `show tree` (and the breadcrumb) returns to split with the same memory selected.
- [ ] **Lenses:** Recent / Hubs / Orphans each repopulate the left pane as flat lists; Hubs rows show the `N↳` in_degree metric.
- [ ] **Search:** typing in the top-bar field replaces the left pane with recall results; clearing it restores the active lens.
- [ ] **Deep link + back/forward:** reload on a `/<ns>/<key>` URL opens that memory; browser Back/Forward move between previously-opened memories.
- [ ] **Empty reader:** with nothing selected the pane reads "Select a memory." (or the empty-store orient copy if the store is empty).

- [ ] **Step 4: Final commit (if the smoke test prompted any fixes)**

```bash
git add -A
git commit -m "fix(ui): address findings from browser smoke test"
```

(If the smoke test surfaced no issues, skip this commit.)

---

## Self-review notes

- **Spec coverage:** full-viewport shell (Task 9) · client-side tree with lazy leaves (Tasks 2, 4, 6) · four lenses (Tasks 5, 6) · split reader + drill (Task 7) · address-as-route (Tasks 1, 4) · running total (Tasks 3, 5) · top-bar search bound to recall (Tasks 4, 5, 6) · Foundations grid/spacing (Task 9) · loading skeleton / empty-store / select-a-memory / empty-lens states (Tasks 6, 8). Reused unchanged: `browse-api.ts`, `session.ts`, `read`/`recall`, SPA history fallback.
- **Deferred to P2 (per spec Decisions), intentionally absent here:** Tags lens + list-by-tag backend, prune + `DELETE` guardrail, inline/dangling wikilink parsing, ⌘K palette, full keyboard nav, the complete empty/loading/error matrix.
- **One spec/data mismatch surfaced and decided:** tree-leaf backlink badge (`6↳`) is dropped in P1 because the recent payload carries no degree and P1 adds no backend; Hubs `in_degree` still renders. Flagged at the top, at Task 6, and in the self-review.
- **Type consistency:** `Lens`/`FlatLens` (api.ts), `Row`/`Mode`/`BrowserView` (useBrowser.ts), `TreeNode` (namespaceTree.ts) used identically across components; `toggleFolder`/`expandAll`/`open`/`drill`/`showTree`/`selectLens` names match between `useBrowser` and `Browser.tsx`.
```
