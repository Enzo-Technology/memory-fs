# Lightweight Memory Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only web browser for the shared memory store — browse, search, and read memories (following wikilinks/backlinks) from the SPA, using the session cookie it already holds.

**Architecture:** A session-authenticated JSON API (`browse-api.ts`) is the cookie-path sibling to the bearer Resource Server; it verifies the cookie via the AS's `getSession` (isolated in `session.ts`) and passes through to existing `MemoryStore` read methods. The SPA splits into data (`api.ts`), state (`useBrowser`), and three props-only panes composed by a logic-free `Browser.tsx`.

**Tech Stack:** Node `http`, Better Auth (`auth.api.getSession`, `fromNodeHeaders`), better-sqlite3 via `MemoryStore`, React 19 + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-memory-browser-design.md`

**Conventions confirmed from the codebase:**
- Store methods are synchronous: `store.browse(input): BrowseResult`, `store.recall(input): Memory[]`, `store.read(ns, key): ReadResult | null`.
- Types to reuse: `BrowseResult`, `ReadResult`, `Neighbour` from `src/core/store.ts`; `Memory`, `MemoryType` from `src/core/db.ts`; `BrowseKind` union is `"index" | "recent" | "hubs" | "orphans" | "tags" | "namespaces"`.
- Tests live in `tests/*.test.ts`, run by Vitest (`include: ["tests/**/*.test.ts"]`, single fork). Run all: `npm test`. Run one file: `npx vitest run tests/<file>.test.ts`.
- `better-auth/node` exports `fromNodeHeaders` and `toNodeHandler` (verified).
- The UI is a separate Vite build (`ui/`, `moduleResolution: Bundler`); it may `import type` from `../../src/...` — type-only, stripped at build, no runtime coupling. UI typecheck: `npx tsc -p ui/tsconfig.json --noEmit`.
- The repo has **no React/component test harness** (no jsdom/RTL). Per the spec, UI acceptance is build + manual verification; we do not introduce a component test runner (YAGNI, matches the existing zero-UI-test codebase). The browse logic is unit-tested at the server boundary instead.

---

## File Structure

**Server (create):**
- `src/lib/session.ts` — `makeRequireSession(auth)` → cookie → `Session | null`. Hides the Better Auth + Node-header coupling. Mirror of `resource-server.ts`'s `makeAuthenticate`.
- `src/lib/browse-api.ts` — `makeBrowseApi(store, requireSession)` → `(req, res)`. Router + 3 validating pass-through handlers.

**Server (modify):**
- `src/index.ts` — construct the API and add one route branch after `/mcp`, before `serveWebApp`.

**Server (test, create):**
- `tests/session.test.ts` — guard with a fake `auth`.
- `tests/browse-api.test.ts` — handlers with a real store + fake guard.
- `tests/server.http.test.ts` — add one integration case: `/api/memories` with no cookie → 401.

**UI (create):**
- `ui/src/api.ts` — the three endpoints, the only holder of URLs + `credentials:"include"`.
- `ui/src/useBrowser.ts` — all browse/search/detail state.
- `ui/src/Facets.tsx`, `ui/src/MemoryList.tsx`, `ui/src/MemoryDetail.tsx` — props-only panes.
- `ui/src/Browser.tsx` — logic-free composer.

**UI (modify):**
- `ui/src/Shell.tsx` — add an optional `wide` prop for the 3-pane layout.
- `ui/src/Dashboard.tsx` — render `<Browser/>` instead of "coming soon".

---

## Task 1: Session guard (`session.ts`)

**Files:**
- Create: `src/lib/session.ts`
- Test: `tests/session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/session.test.ts
import { describe, expect, it } from "vitest";
import { makeRequireSession } from "../src/lib/session.js";

// A fake AS: getSession honours only the cookie header (via the translated Headers),
// so this also proves fromNodeHeaders maps req.headers.cookie → Headers.get("cookie").
function fakeAuth(validCookie: string) {
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("cookie") === validCookie
          ? { session: { id: "s1" }, user: { id: "u1", email: "a@b.co" } }
          : null,
    },
  } as unknown as Parameters<typeof makeRequireSession>[0];
}

describe("makeRequireSession", () => {
  it("returns the session when the cookie is valid", async () => {
    const requireSession = makeRequireSession(fakeAuth("token=good"));
    const session = await requireSession({ headers: { cookie: "token=good" } } as never);
    expect(session).not.toBeNull();
    expect(session!.user.id).toBe("u1");
  });

  it("returns null when the cookie is missing", async () => {
    const requireSession = makeRequireSession(fakeAuth("token=good"));
    const session = await requireSession({ headers: {} } as never);
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — cannot resolve `../src/lib/session.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/session.ts
// The cookie-path guard: turns an HTTP request's cookie into a verified session by
// deferring to the Authorization Server's getSession (sessions are stateful + same-origin,
// so we defer rather than verify locally — see CONTEXT.md). The session/cookie sibling of
// resource-server.ts's makeAuthenticate (the bearer/JWT guard). This file is the one place
// that knows the Better Auth getSession API and the Node-headers → Headers translation.
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingMessage } from "node:http";
import type { makeAuth } from "./auth.js";

type Auth = ReturnType<typeof makeAuth>;

// The verified session (or null). Shape owned by Better Auth; we re-export the awaited type
// so callers needn't reach into the AS.
export type Session = Awaited<ReturnType<Auth["api"]["getSession"]>>;

export function makeRequireSession(
  auth: Auth,
): (req: IncomingMessage) => Promise<Session> {
  return (req) => auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts tests/session.test.ts
git commit -m "feat(api): cookie-path session guard (makeRequireSession)"
```

---

## Task 2: Read-only data API (`browse-api.ts`)

**Files:**
- Create: `src/lib/browse-api.ts`
- Test: `tests/browse-api.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/browse-api.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db.js";
import { MemoryStore } from "../src/core/store.js";
import { makeBrowseApi } from "../src/lib/browse-api.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "memfs-api-"));
  return new MemoryStore(openDb(join(dir, "test.db")));
}

// Minimal ServerResponse double: capture status + body.
function fakeRes() {
  const out: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(body?: string) {
      out.body = body;
    },
    out,
  };
  return res;
}

// Guard doubles: a present session vs none. Lets us test routing/validation without auth.
const withSession = () =>
  Promise.resolve({ session: { id: "s" }, user: { id: "u" } } as never);
const noSession = () => Promise.resolve(null as never);

function call(store: MemoryStore, guard: () => Promise<never>, url: string) {
  const api = makeBrowseApi(store, guard);
  const res = fakeRes();
  return api({ url } as never, res as never).then(() => res.out);
}

describe("browse-api", () => {
  it("401 when there is no session", async () => {
    const out = await call(freshStore(), noSession, "/api/memories");
    expect(out.status).toBe(401);
  });

  it("browse recent returns the store result shape", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "hello world" });
    const out = await call(store, withSession, "/api/memories?kind=recent");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.kind).toBe("recent");
    expect(body.items[0].key).toBe("a");
  });

  it("400 on unknown browse kind", async () => {
    const out = await call(freshStore(), withSession, "/api/memories?kind=bogus");
    expect(out.status).toBe(400);
  });

  it("400 when recall q is missing", async () => {
    const out = await call(freshStore(), withSession, "/api/memories/recall");
    expect(out.status).toBe(400);
  });

  it("recall returns matching memories", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "the quick brown fox" });
    const out = await call(store, withSession, "/api/memories/recall?q=quick");
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body!)[0].key).toBe("a");
  });

  it("read returns the record with its neighbourhood", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "body" });
    const out = await call(store, withSession, "/api/memories/ns/a");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.key).toBe("a");
    expect(Array.isArray(body.children)).toBe(true);
    expect(Array.isArray(body.backlinks)).toBe(true);
  });

  it("404 on unknown memory", async () => {
    const out = await call(freshStore(), withSession, "/api/memories/ns/missing");
    expect(out.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/browse-api.test.ts`
Expected: FAIL — cannot resolve `../src/lib/browse-api.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/browse-api.ts
// The read-only, session-authenticated JSON API: the cookie-path sibling to the bearer
// Resource Server. Applies the session guard, then passes through to the MemoryStore's read
// methods. Knows nothing about HOW a session is verified (that's session.ts) — it depends on
// a guard function. Read-only by intent: writes stay on the MCP/agent path.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowseKind, MemoryStore } from "../core/store.js";
import type { Session } from "./session.js";

const BROWSE_KINDS = new Set<BrowseKind>([
  "index",
  "recent",
  "hubs",
  "orphans",
  "tags",
  "namespaces",
]);

type RequireSession = (req: IncomingMessage) => Promise<Session>;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function num(v: string | null): number | undefined {
  return v === null ? undefined : Number(v);
}

export function makeBrowseApi(store: MemoryStore, requireSession: RequireSession) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Boundary: no valid session → 401. The org perimeter is upstream (Google Internal
    // consent); here we only require *a* signed-in principal, not a specific one — reads are
    // global, matching the shared-store model and the /mcp read tools.
    const session = await requireSession(req);
    if (!session) return json(res, 401, { error: "unauthenticated" });

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const q = url.searchParams;

    // GET /api/memories/recall — full-text search. Checked before the detail pattern below;
    // they cannot collide (recall has one path segment, detail requires two).
    if (path === "/api/memories/recall") {
      const query = q.get("q");
      if (!query) return json(res, 400, { error: "q is required" });
      return json(
        res,
        200,
        store.recall({
          query,
          namespace: q.get("namespace") ?? undefined,
          limit: num(q.get("limit")),
        }),
      );
    }

    // GET /api/memories/:namespace/:key — one record + its depth-1 neighbourhood.
    const detail = path.match(/^\/api\/memories\/([^/]+)\/([^/]+)$/);
    if (detail) {
      const result = store.read(
        decodeURIComponent(detail[1]!),
        decodeURIComponent(detail[2]!),
      );
      if (!result) return json(res, 404, { error: "not found" });
      return json(res, 200, result);
    }

    // GET /api/memories — a browse lens (default: recent).
    if (path === "/api/memories") {
      const kind = (q.get("kind") ?? "recent") as BrowseKind;
      if (!BROWSE_KINDS.has(kind)) return json(res, 400, { error: "unknown kind" });
      return json(
        res,
        200,
        store.browse({
          kind,
          namespace: q.get("namespace") ?? undefined,
          prefix: q.get("prefix") ?? undefined,
          limit: num(q.get("limit")),
        }),
      );
    }

    return json(res, 404, { error: "not found" });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/browse-api.test.ts`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/browse-api.ts tests/browse-api.test.ts
git commit -m "feat(api): read-only browse/recall/read JSON endpoints"
```

---

## Task 3: Wire the API into the server

**Files:**
- Modify: `src/index.ts` (imports near top; route branch in the HTTP handler, after the `/mcp` block and before the final `serveWebApp(url, res)` call)
- Test: `tests/server.http.test.ts` (add one case)

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the existing `describe("server HTTP transport", ...)` in `tests/server.http.test.ts`, after the last existing test:

```typescript
  it("returns 401 on /api/memories without a session cookie", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/memories?kind=recent`);
      expect(res.status).toBe(401);
    } finally {
      server.kill();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/server.http.test.ts`
Expected: FAIL — status is 200 (the SPA catch-all `serveWebApp` currently serves `index.html` for `/api/memories`, so it is not 401). Note: this test spawns `dist/index.js`, so the build step is required for it to reflect source changes.

- [ ] **Step 3: Add the imports**

In `src/index.ts`, add to the import block (alongside the existing `resource-server` / `auth-ui` imports):

```typescript
import { makeRequireSession } from "./lib/session.js";
import { makeBrowseApi } from "./lib/browse-api.js";
```

- [ ] **Step 4: Construct the handler**

In `src/index.ts`, inside the `if (httpPort) { ... }` block, after `const authenticate = makeAuthenticate(BASE_URL);`, add:

```typescript
  // The cookie-path read API for the browser. Same store, session auth instead of bearer.
  const browseApi = makeBrowseApi(store, makeRequireSession(auth));
```

- [ ] **Step 5: Add the route branch**

In `src/index.ts`, in the `createHttpServer` callback, immediately **after** the closing `}` of the `if (url === "/mcp" || url.startsWith("/mcp")) { ... }` block and **before** the final `// Everything else: the single-page web app` / `serveWebApp(url, res);`, insert:

```typescript
    // Resource read API for the browser UI: cookie-session authenticated, read-only.
    // Routed before the SPA catch-all so the history fallback can never swallow it.
    if (url.startsWith("/api/memories")) {
      await browseApi(req, res);
      return;
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/server.http.test.ts`
Expected: PASS (all cases, including the new 401 case).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all files green).

- [ ] **Step 8: Commit**

```bash
git add src/index.ts tests/server.http.test.ts
git commit -m "feat(api): route /api/memories to the read API before the SPA catch-all"
```

---

## Task 4: UI data layer (`api.ts`)

**Files:**
- Create: `ui/src/api.ts`

- [ ] **Step 1: Write the module**

```typescript
// ui/src/api.ts
// The data layer: the only place that knows endpoint URLs and that the cookie must travel
// (credentials: "include"). Response shapes are imported (type-only) from the server's store
// types — never re-declared here — so the only client↔server coupling is the URL strings.
import type { BrowseResult, ReadResult } from "../../src/core/store";
import type { Memory } from "../../src/core/db";

// The browse lenses the UI exposes (subset of the store's BrowseKind: no "index"/"tags" — see
// the spec's deferred-tags note).
export type Facet = "recent" | "namespaces" | "hubs" | "orphans";

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

export function listMemories(facet: Facet, namespace?: string): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind: facet });
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

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p ui/tsconfig.json --noEmit`
Expected: PASS (no errors). This confirms the type-only `../../src/...` imports resolve from the UI build.

- [ ] **Step 3: Commit**

```bash
git add ui/src/api.ts
git commit -m "feat(ui): memory browser data layer (api.ts)"
```

---

## Task 5: Widen the Shell for a 3-pane layout

**Files:**
- Modify: `ui/src/Shell.tsx`

- [ ] **Step 1: Add a `wide` prop**

Replace the entire contents of `ui/src/Shell.tsx` with:

```typescript
import type { ReactNode } from "react";

// Shared page chrome. Every screen is a centered card; factoring it here keeps the
// route components about behavior, not layout. `wide` swaps the narrow auth-card width for a
// full-width canvas — the memory browser's three panes need the room.
export function Shell({
  title = "memory-fs",
  wide = false,
  children,
}: {
  title?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        fontFamily: "system-ui",
        maxWidth: wide ? "72rem" : "24rem",
        margin: wide ? "2rem auto" : "4rem auto",
        padding: "0 1rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <h1>{title}</h1>
      {children}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p ui/tsconfig.json --noEmit`
Expected: PASS. (Existing callers pass no `wide`, so they default to the narrow card — unchanged.)

- [ ] **Step 3: Commit**

```bash
git add ui/src/Shell.tsx
git commit -m "feat(ui): optional wide layout in Shell for the browser"
```

---

## Task 6: Browser state hook (`useBrowser.ts`)

**Files:**
- Create: `ui/src/useBrowser.ts`

- [ ] **Step 1: Write the hook**

```typescript
// ui/src/useBrowser.ts
// All browser state and orchestration: which lens is active, the search query, and the
// selected memory. Renders nothing — it hands a view-model + actions to the panes. This is the
// deep module; the panes are thin over it.
import { useEffect, useState } from "react";
import { listMemories, readMemory, recall, type Facet } from "./api";
import type { BrowseResult, ReadResult } from "../../src/core/store";

export interface Row {
  namespace: string;
  key: string;
  snippet: string;
}

export interface BrowserView {
  facet: Facet;
  query: string;
  browse: BrowseResult | null; // raw lens result (panes read .kind to render)
  results: Row[] | null; // search results; non-null only while a query is active
  detail: ReadResult | null;
  selectFacet: (f: Facet) => void;
  selectNamespace: (ns: string) => void;
  setQuery: (q: string) => void;
  open: (namespace: string, key: string) => void;
}

export function useBrowser(): BrowserView {
  const [facet, setFacet] = useState<Facet>("recent");
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [results, setResults] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<{ namespace: string; key: string } | null>(null);
  const [detail, setDetail] = useState<ReadResult | null>(null);

  // List source: a non-empty query searches; otherwise the active lens drives the list.
  useEffect(() => {
    let live = true;
    const trimmed = query.trim();
    if (trimmed) {
      recall(trimmed).then((ms) => {
        if (live)
          setResults(
            ms.map((m) => ({ namespace: m.namespace, key: m.key, snippet: m.content.slice(0, 140) })),
          );
      });
    } else {
      listMemories(facet, namespace).then((b) => {
        if (live) {
          setBrowse(b);
          setResults(null);
        }
      });
    }
    return () => {
      live = false;
    };
  }, [facet, namespace, query]);

  // Detail source.
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

  return {
    facet,
    query,
    browse,
    results,
    detail,
    selectFacet: (f) => {
      setQuery("");
      setNamespace(undefined);
      setFacet(f);
    },
    selectNamespace: (ns) => {
      setQuery("");
      setFacet("recent");
      setNamespace(ns);
    },
    setQuery,
    open: (ns, key) => setSelected({ namespace: ns, key }),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p ui/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/src/useBrowser.ts
git commit -m "feat(ui): useBrowser state/orchestration hook"
```

---

## Task 7: The three panes

**Files:**
- Create: `ui/src/Facets.tsx`, `ui/src/MemoryList.tsx`, `ui/src/MemoryDetail.tsx`

- [ ] **Step 1: Write `Facets.tsx`**

```typescript
// ui/src/Facets.tsx
// The lens switcher. Props in, events out — no fetching, no state. Lenses limited to those that
// resolve to memory items the user can open (tags deferred — see spec).
import type { Facet } from "./api";

const FACETS: Facet[] = ["recent", "namespaces", "hubs", "orphans"];

export function Facets({
  active,
  onSelect,
}: {
  active: Facet;
  onSelect: (f: Facet) => void;
}) {
  return (
    <nav style={{ display: "grid", gap: "0.25rem", alignContent: "start" }}>
      {FACETS.map((f) => (
        <button
          key={f}
          onClick={() => onSelect(f)}
          style={{ fontWeight: f === active ? 700 : 400, textAlign: "left" }}
        >
          {f}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `MemoryList.tsx`**

```typescript
// ui/src/MemoryList.tsx
// Search box + the current list. Renders search results when present; otherwise switches on the
// browse lens: namespaces → drill-in rows; recent/hubs/orphans → openable memory rows. Props
// only — the kind→render mapping is presentation, the data shaping lives upstream.
import type { BrowseResult } from "../../src/core/store";
import type { Row } from "./useBrowser";

export function MemoryList({
  query,
  onQuery,
  browse,
  results,
  onOpen,
  onNamespace,
}: {
  query: string;
  onQuery: (q: string) => void;
  browse: BrowseResult | null;
  results: Row[] | null;
  onOpen: (namespace: string, key: string) => void;
  onNamespace: (namespace: string) => void;
}) {
  return (
    <section style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
      <input
        value={query}
        placeholder="Search…"
        onChange={(e) => onQuery(e.target.value)}
      />
      {results
        ? results.map((r) => (
            <Item
              key={`${r.namespace}/${r.key}`}
              title={`${r.namespace}/${r.key}`}
              snippet={r.snippet}
              onClick={() => onOpen(r.namespace, r.key)}
            />
          ))
        : renderBrowse(browse, onOpen, onNamespace)}
    </section>
  );
}

function renderBrowse(
  browse: BrowseResult | null,
  onOpen: (namespace: string, key: string) => void,
  onNamespace: (namespace: string) => void,
) {
  if (!browse) return <p>…</p>;
  if (browse.kind === "namespaces") {
    return browse.items.map((n) => (
      <Item
        key={n.namespace}
        title={n.namespace}
        snippet={`${n.count} memories`}
        onClick={() => onNamespace(n.namespace)}
      />
    ));
  }
  if (browse.kind === "recent" || browse.kind === "hubs" || browse.kind === "orphans") {
    return browse.items.map((m) => (
      <Item
        key={`${m.namespace}/${m.key}`}
        title={`${m.namespace}/${m.key}`}
        snippet={m.snippet}
        onClick={() => onOpen(m.namespace, m.key)}
      />
    ));
  }
  return null; // index/tags not reachable from the facet set
}

function Item({
  title,
  snippet,
  onClick,
}: {
  title: string;
  snippet: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", display: "grid", gap: "0.15rem" }}>
      <strong>{title}</strong>
      <span style={{ opacity: 0.7, fontSize: "0.85em" }}>{snippet}</span>
    </button>
  );
}
```

- [ ] **Step 3: Write `MemoryDetail.tsx`**

```typescript
// ui/src/MemoryDetail.tsx
// One memory: its content as text, plus its depth-1 neighbourhood (children + backlinks) as
// clickable rows — that is the wikilink/backlink navigation. The `read` call already returns the
// neighbourhood, so no extra fetching here. Props only.
import type { ReadResult } from "../../src/core/store";

export function MemoryDetail({
  detail,
  onNavigate,
}: {
  detail: ReadResult | null;
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (!detail) {
    return (
      <section style={{ opacity: 0.6 }}>
        <p>Select a memory.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
      <header>
        <strong>{detail.namespace}/{detail.key}</strong>
        <div style={{ opacity: 0.7, fontSize: "0.85em" }}>{detail.type}</div>
      </header>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{detail.content}</pre>
      <Neighbours title="Links" items={detail.children} onNavigate={onNavigate} />
      <Neighbours title="Backlinks" items={detail.backlinks} onNavigate={onNavigate} />
    </section>
  );
}

function Neighbours({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: ReadResult["children"];
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <em>{title}</em>
      {items.map((n) => (
        <button
          key={`${n.namespace}/${n.key}`}
          onClick={() => onNavigate(n.namespace, n.key)}
          style={{ textAlign: "left" }}
        >
          {n.namespace}/{n.key} <span style={{ opacity: 0.6 }}>({n.relation})</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p ui/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/Facets.tsx ui/src/MemoryList.tsx ui/src/MemoryDetail.tsx
git commit -m "feat(ui): Facets, MemoryList, MemoryDetail panes"
```

---

## Task 8: Compose the browser and wire it into Dashboard

**Files:**
- Create: `ui/src/Browser.tsx`
- Modify: `ui/src/Dashboard.tsx`

- [ ] **Step 1: Write `Browser.tsx`**

```typescript
// ui/src/Browser.tsx
// The composer: calls useBrowser and wires its view-model + actions into the three panes. No
// logic of its own — if a derived/massaged prop is ever needed, it belongs in useBrowser, not
// here (keeps this from rotting into a pass-through layer).
import { useBrowser } from "./useBrowser";
import { Facets } from "./Facets";
import { MemoryList } from "./MemoryList";
import { MemoryDetail } from "./MemoryDetail";

export function Browser() {
  const vm = useBrowser();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "8rem 22rem 1fr",
        gap: "1.5rem",
        alignItems: "start",
      }}
    >
      <Facets active={vm.facet} onSelect={vm.selectFacet} />
      <MemoryList
        query={vm.query}
        onQuery={vm.setQuery}
        browse={vm.browse}
        results={vm.results}
        onOpen={vm.open}
        onNamespace={vm.selectNamespace}
      />
      <MemoryDetail detail={vm.detail} onNavigate={vm.open} />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `Dashboard.tsx`**

Replace the entire contents of `ui/src/Dashboard.tsx` with:

```typescript
import { useEffect } from "react";
import { authClient } from "./auth";
import { Shell } from "./Shell";
import { Browser } from "./Browser";

// The session-gated app home: the memory browser. Anything that isn't /sign-in, /sign-up, or
// /consent lands here.
export function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  // No session → this is a private surface, send them to sign in.
  useEffect(() => {
    if (!isPending && !session) location.href = "/sign-in";
  }, [isPending, session]);

  if (isPending || !session) return <Shell><p>…</p></Shell>;

  return (
    <Shell wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>
          Signed in as <strong>{session.user.email}</strong>.
        </span>
        <button onClick={() => authClient.signOut().then(() => location.reload())}>
          Sign out
        </button>
      </div>
      <Browser />
    </Shell>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p ui/tsconfig.json --noEmit && npm run build:ui`
Expected: PASS — typecheck clean, `vite build ui` writes `dist/ui` with no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/Browser.tsx ui/src/Dashboard.tsx
git commit -m "feat(ui): compose the memory browser into the dashboard"
```

---

## Task 9: Full build + manual acceptance

**Files:** none (verification only)

- [ ] **Step 1: Full build and test suite**

Run: `npm run build && npm test`
Expected: build succeeds (`vite build ui && tsc` clean); all Vitest files pass.

- [ ] **Step 2: Run the server locally**

Run (needs the env the HTTP server requires):

```bash
MEMORY_FS_HTTP_PORT=3000 \
BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret-32 \
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET \
node dist/index.js
```

(Or use `npm run dev` with a populated `.env`.) Expected log: `[memory-fs] listening on 127.0.0.1:3000`.

- [ ] **Step 3: Manual acceptance checklist**

Open `http://localhost:3000`, sign in with Google, then verify:
- The dashboard shows the three-pane browser (facets · list · detail), not "coming soon".
- The list defaults to **recent** memories; clicking a memory opens it in the detail pane.
- Typing in the search box swaps the list to recall results; clearing it returns to the lens.
- Clicking the **namespaces** facet lists namespaces; clicking one drills into that namespace's recent memories.
- **hubs** and **orphans** facets list openable memory rows.
- In the detail pane, a memory's **Links**/**Backlinks** rows are clickable and re-target the detail pane.
- Signing out returns to sign-in; reloading `/` while signed out redirects to `/sign-in`.

- [ ] **Step 4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore: memory browser manual-acceptance pass"
```

---

## Self-Review Notes

- **Spec coverage:** session/cookie data path (Tasks 1, 3); three endpoints (Task 2); no principal scoping (Task 2 comment + 401-only gate); `api.ts`/`useBrowser`/three panes/composer (Tasks 4, 6, 7, 8); shared types imported not re-declared (Task 4); logic-free composer (Task 8); facets recent/namespaces/hubs/orphans, tags deferred (Tasks 4, 7); widened Shell (Task 5); read-only — no write endpoints or UI anywhere.
- **Deferred (per spec, intentionally absent):** tags facet, markdown rendering, `[[wikilink]]`-in-body linkifying, any write path.
- **Type consistency:** `Facet` (`api.ts`) is the UI lens subset; `BrowseKind` (store) is the server union validated in `browse-api.ts`. `Row` is defined in `useBrowser.ts` and consumed by `MemoryList`. `Session` defined in `session.ts`, consumed by `browse-api.ts`. Guard signature `(req) => Promise<Session>` matches between `session.ts` and `browse-api.ts`'s `RequireSession`.
- **No component test harness introduced:** consistent with the existing codebase; browse logic is covered at the server boundary (Task 2), UI by build + manual acceptance (Task 9).
