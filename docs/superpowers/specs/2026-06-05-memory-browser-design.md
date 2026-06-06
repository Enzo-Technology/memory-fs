# Lightweight memory browser — design

Date: 2026-06-05
Status: approved, pending implementation plan

## Goal

A very lightweight, read-only web browser for the shared memory store. The SPA
already exists (sign-in / consent / `Dashboard`); today `Dashboard` only says
"Memory browser coming soon." This design fills that in: browse, search, and
read memories — following wikilinks and backlinks — from the browser, using the
session cookie the SPA already holds.

Read-only by intent. Writes stay on the MCP/agent path; the browser adds no
second write surface to secure or validate.

## The crux: the session/cookie data path

Memory data is exposed over HTTP only at `/mcp`, which requires a **bearer JWT**
(verified locally against the AS's JWKS — see `resource-server.ts`). The browser
holds a **session cookie**, not a bearer. So there is no path today for the SPA
to read memories with the credential it has.

We bridge that gap with the cookie-path sibling of the Resource Server: a
read-only JSON API that authenticates by **deferring to the AS's `getSession`**.
This is exactly the "session / cookie" authentication path already named in
`CONTEXT.md` ("verified by deferring to the AS's `getSession`, because sessions
are stateful and same-origin").

Rejected alternative: making the browser an in-page MCP client (do the OAuth
dance to get a bearer, call `/mcp` tools). Zero new server routes, but pushes
OAuth + MCP-client complexity into the browser. The JSON API is less total code.

### No principal scoping

The session API requires a valid session but does **not** scope reads by
principal. This matches the shared-store positioning (one hosted store for the
team) and the existing `/mcp` read tools, which are not author-scoped either.
The org boundary is enforced upstream by Google's "Internal" OAuth consent
screen. (`store.note()` records an author; reads do not filter on it.)

## Architecture (server)

Two files, separating the **session gate** from the **data API** — modular along
the auth/data seam, not split for its own sake.

### `src/lib/session.ts` — the cookie-path guard

`makeRequireSession(auth)` → `(req: IncomingMessage) => Promise<Session | null>`.
Verifies the session via `auth.api.getSession({ headers })`, translating the Node
`IncomingMessage` headers into the `Headers` object Better Auth expects. Returns
the session or `null`.

A deliberate mirror of `resource-server.ts`'s `makeAuthenticate` (the bearer
guard): the two authentication paths named in `CONTEXT.md` — bearer/JWT and
session/cookie — now each have a one-purpose guard with the same shape. Depends
only on `auth`; knows nothing about memories or routing.

### `src/lib/browse-api.ts` — the read-only data API

`makeBrowseApi(store, requireSession)` → `(req, res) => void`. The router:
applies the guard (no session → `401`), matches the three routes, dispatches,
serializes. The three handlers are small private functions in this file (three,
not four — they stay in one file per the codebase's "wait for the fourth" rule),
each a thin pass-through to an existing `MemoryStore` method. No new store code.
Depends on `store` and the guard; knows nothing about how a session is verified.

### Wiring

Into `src/index.ts` as a single branch, placed **after** the `/mcp` branch and
**before** the `serveWebApp` catch-all (so the history fallback can never swallow
it, same discipline as `/mcp`):

```
if (url.startsWith("/api/memories")) return browseApi(req, res)
```

## Endpoints

All read-only, all session-gated, all thin wrappers over existing store methods.

| Route | Store call | Returns |
|---|---|---|
| `GET /api/memories?kind=&namespace=&prefix=&limit=` | `store.browse(input)` | `BrowseResult` |
| `GET /api/memories/recall?q=&namespace=&tags=&limit=` | `store.recall(input)` | `Memory[]` |
| `GET /api/memories/:namespace/:key` | `store.read(ns, key)` | `ReadResult` (with `children` + `backlinks`); `404` if null |

`kind` is validated against the `BrowseKind` union at the boundary; an unknown
kind is a `400`. `recall` requires a non-empty `q`.

## UI

Replace `Dashboard`'s "coming soon" body with the browser. Split into three
layers — **data, state, view** — so each is understandable and testable on its
own.

### Data layer — `ui/src/api.ts`

`listMemories(params)`, `recall(q, params)`, `readMemory(ns, key)`. The only
place that knows endpoint URLs and `credentials:"include"`. Depends on nothing
but `fetch`.

The response shapes (`BrowseResult` / `Memory` / `ReadResult`) are **imported
from the store's exported types**, not re-declared in the UI — so the only
client↔server coupling is the URL strings. Re-declaring these shapes per pane
would leak the JSON contract into many places (design-audit flag).

### State — `ui/src/useBrowser.ts`

A hook owning all browser state (`facet`, `query`, `selected`) and orchestrating
`api.ts`. Returns a view-model (current list, selected detail, loading) plus
actions (`selectFacet`, `setQuery`, `open(ns, key)`). Isolates browse/search/
navigation logic from rendering; depends only on `api.ts`.

### View — three presentational panes + a composer

Props-only, no data fetching of their own, inside the existing `Shell` (widened
from its current 24rem card):

**facet sidebar · list · detail**

- **`Facets.tsx`** — renders the lens list, calls `onSelect`. Lenses that return
  memory items: **recent (default), namespaces, hubs, orphans**. Selecting a
  namespace drills in via `browse(kind:"recent", namespace:X)`; selecting a
  hub/orphan row opens it in detail like any other memory item.
- **`MemoryList.tsx`** — search box + list. Default source `browse(kind:"recent")`;
  a non-empty query swaps the source to `recall(q)`. Each row is
  `{namespace, key, snippet}`, calls `onOpen`.
- **`MemoryDetail.tsx`** — renders `content` as text plus `children` and
  `backlinks` (each `{namespace, key, relation, snippet}`) as clickable rows that
  call `onNavigate`. This is the wikilink / backlink navigation — one `read` call
  already returns the depth-1 neighbourhood.
- **`Browser.tsx`** — thin composer: calls `useBrowser`, wires its view-model and
  actions into the three panes. No logic of its own — it must stay logic-free; any
  prop-deriving or massaging belongs in `useBrowser`, else it rots into a
  pass-through layer (design-audit flag).

### Deferred: tags facet

`browse` lenses split in two: `recent` / `hubs` / `orphans` return memory items
(directly clickable); `tags` / `namespaces` return counts. Namespaces drill in
cleanly. **Tags do not** — there is no "list memories with tag X" path, and
`recall` requires an FTS query string. A clickable tag facet would need a new
`store` method (e.g. `byTag`). Deferred from v1 to keep the change minimal; the
facet sidebar ships without tags.

### Client conventions

- Plain `fetch` with `credentials:"include"` (same-origin; cookie travels),
  confined to `api.ts`.
- `useState` / `useEffect` inside `useBrowser`. No react-query, no router library
  — the URL already drives screen selection in `App.tsx`.

## Build & serving

No change to the build or serving path. The browser is more React inside the
existing `vite build ui → dist/ui` bundle, served by `serveWebApp`. The new API
branch is the only server-side addition, alongside the existing `/mcp` and
`/api/auth` branches in `index.ts`.

## Boundaries

Server:

- `session.ts` — cookie → `Session | null`. Depends on `auth`. Knows nothing of
  memories, routing, or the UI. Testable: a request with/without a valid cookie.
- `browse-api.ts` — request + guard → JSON memory response. Depends on `store`
  and the guard. Knows nothing about how a session is verified or about the UI.

UI:

- `api.ts` — endpoints → typed results. The only holder of URLs/`fetch`. No state,
  no rendering.
- `useBrowser.ts` — owns browse/search/detail state; depends only on `api.ts`.
  Knows nothing about how sessions are verified or how panes render.
- `Facets` / `MemoryList` / `MemoryDetail` — props in, events out. No fetching,
  no shared state; each swappable without touching the others.
- `Browser.tsx` — composes the hook and the panes. No logic.

## Testing

- `session.ts`: valid cookie → session; missing/invalid cookie → `null`.
- `browse-api.ts`: no/invalid session → `401`; a valid session → the expected
  store result shape for each of the three routes; unknown `kind` → `400`;
  missing `recall` `q` → `400`; unknown memory → `404`.
- UI: the panes are thin and props-only — `useBrowser` carries the logic worth a
  unit test (facet switch changes list source; non-empty query swaps to recall).
  Manual verification in the running app (sign in, browse, search, click into a
  memory, follow a backlink) is the acceptance check.

## Out of scope (v1)

- Any write (create / edit / delete) from the browser.
- Tag-based filtering (see Deferred).
- Markdown rendering of content beyond plain text.
- Linkifying raw `[[wikilink]]` syntax inside content body (navigation is via
  the `children` / `backlinks` lists `read` already returns).
