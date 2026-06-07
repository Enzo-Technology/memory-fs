# Memory browser — filesystem-tree IA + Foundations grid — design

Date: 2026-06-07
Status: draft, pending review
Supersedes the UI half of `2026-06-05-memory-browser-design.md` (the read API and
session auth from that spec stand; this changes the IA and visual layout).
Source of intent: Ben's `Memory Browser Spec (offline).html` (orient/read/prune),
the mid-fi screens (`Namespace Browser.html` + `browser-screens.js`), and
`Foundations.html`.

## Goal

Turn the current flat three-pane browser into the designed product: the store
**browsed like a filesystem** — a collapsible namespace tree on the left, lenses
(mode/filters) across the top, a reading pane on the right that drills to a
full-page read. Three verbs only: **orient, read, prune.** Still local, still
no authoring.

Two things Ben called out as first-class, not afterthoughts:
1. **Grid & spacing** — the layout itself (column structure, the 4px rhythm, the
   reading measure) is part of the design, specified concretely below.
2. **The IA** — went through several revisions and has landed: **file-browser
   tree, collapsible, on the left; mode/filters on top.** Build to that shape.

## What already exists (don't rebuild)

- **Session-auth read API** (`src/lib/browse-api.ts`, `src/lib/session.ts`):
  `GET /api/memories?kind=…`, `/recall?q=`, `/:ns/:key`. All five browse kinds
  (incl. `tags`), recall, and read-with-neighbourhood are live and tested. The
  bearer token never reaches the browser — the same-origin Node server holds it
  and the browser carries only a session cookie. This already realizes the spec's
  "token stays server-side, browser talks only to localhost" requirement; we do
  **not** need a separate proxy.
- **Foundations visual system** applied (`ui/src/styles.css`, `memoryType.ts`):
  warm paper, forest-green nav accent, Noto Sans, five type hues. Tokens carry
  forward unchanged; this spec rearranges the *layout* that uses them.
- **Data layer / state / panes** (`api.ts`, `useBrowser.ts`, `Facets`,
  `MemoryList`, `MemoryDetail`, `Browser`). The tree IA replaces the left rail
  and list; `api.ts` and the read API are reused.

## The memory model (the five facts the UI leans on)

1. Address = `(namespace, key)`; namespace is a **flat string that may contain
   colons**; key is a slug. Display: colon-joined namespace segments, then `/`,
   then key — `voice:onboarding/greeting-tone`. Colon = structural; slash =
   namespace↔key. Hold this everywhere.
2. Five types (`user|feedback|project|reference|note`) — the primary semantic
   axis; each owns a muted hue (already in `memoryType.ts`).
3. Links are directional: `children` (out) + `backlinks` (in). `read` returns the
   depth-1 neighbourhood (≤20 each) with snippets in one call.
4. **No stored title.** The first non-empty line of content is the de-facto
   title and snippet (store caps ~160 chars). The UI must lead with that line and
   never invent a title.
5. Memories carry tags, metadata, attribution (`created_by`/`updated_by`).

## Information architecture

### The tree is a client-side construction (the key implementation note)

The server has **no nested folders** — it stores `namespace` as a flat string and
lists distinct namespaces with counts. The hierarchy is built in the client:

1. Fetch the namespace vocabulary — `browse?kind=namespaces` → `[{namespace,
   count}]` (e.g. `voice:onboarding (12)`, `voice:errors (6)`).
2. **Split each namespace on `:`** and fold segments into a folder tree;
   `voice` becomes parent of `onboarding` and `errors`. A leaf folder owns the
   memory count.
3. When a leaf folder opens, **lazy-fetch its memories** —
   `browse?kind=recent&namespace=<exact string>` → render leaves, each with a
   type dot and backlink count (`6↳`).

Derive, don't round-trip: fetch the namespace list once, cache it, rebuild the
tree client-side. Only leaf contents are fetched on demand.

### Lenses re-cut the same store (mode/filters, on top)

A horizontal lens row sits above the tree. Selecting a lens **swaps what
populates the left pane; it never changes the layout.**

- **Namespaces** — the hierarchical tree (default).
- **Recent** — flat list by `updated_at` desc (`browse?kind=recent`).
- **Hubs** — by inbound link count (`browse?kind=hubs`, render `in_degree`).
- **Orphans** — no links in or out (`browse?kind=orphans`); prune candidates.
- **Tags** — tag vocabulary with counts (`browse?kind=tags`); picking one filters
  the store. *(See Decisions — tag→list needs a backend answer.)*

A running total (`248 memories · 14 namespaces`) pins to the right of the row.

### Address is the route

Use `/:namespace/:key` as the URL so a memory is linkable and back/forward work;
the breadcrumb mirrors the route. The namespace's colons live in the path —
**URL-encode** them (`%3A`) and decode on read; document this so routing and the
existing `/api/memories/:ns/:key` decode agree.

## Layout grid & spacing (Ben's emphasis — concrete)

The browser is a **full-viewport app**, not a centered card. The current wide
`.shell` card is replaced for this surface by a 100vh flex column:

```
┌ top bar ───────────────────────────────────── 60px ┐  wordmark · search(⌘K) · account
├ lens row ────────────────────────────────────  50px ┤  five lenses · total pinned right
├ body (flex:1, min-height:0) ───────────────────────┤
│  tree pane         │  reading pane                  │
│  340px, collapsible│  1fr                            │
│  border-right hair │  surface white, own scroll      │
└────────────────────┴────────────────────────────────┘
```

- **Body split:** `grid-template-columns: 340px 1fr`. The tree pane is
  **collapsible** — in full-page drill it animates closed and the read pane
  becomes a single centered column; `show tree` restores `340px 1fr`.
- **Spacing:** the existing 4px scale (`--s-1…--s-7`). Row heights: tree row 32px,
  pane headers 46px, lens row 50px, top bar 60px. Tree indent **20px per depth**.
- **Reading measure:** split-pane prose `max-width: 62ch` at 16px/1.7; full-page
  drill widens to **~680px column, 17px/1.75** body, title at display size.
- **Structure is lines + whitespace:** hairlines (`--hairline`) and the single
  vertical rule between panes; no cards. Elevation reserved for the one floating
  surface (⌘K). Forest green only on navigable things (addresses, wikilinks,
  active folder).
- **Type dots** 7px on leaves; **type pills** in headers/lists; tabular-nums on
  all counts.

Lift exact values/markup from the self-contained `screen-split.html` /
`screen-drill.html` (a.k.a. `browser-screens.js`) and `Foundations.html` rather
than re-deriving.

## Screen · Browse (split reader) — the home screen

- **Top bar:** wordmark, wide global search field bound to ⌘K (full-text recall,
  **not** a tree filter), account.
- **Lens row:** the five lenses + running total.
- **Tree pane:** Finder-style disclosure; folders show counts, leaves show a type
  dot + backlink count; **multiple branches open at once**; `expand all` in the
  pane header.
- **Reading pane:** address breadcrumb · type pill · title (first line) · body
  with inline wikilinks · hairline-separated **Links out / Backlinks** pair ·
  tag row. The pane is the surface (no card).

## Screen · Read (full-page drill)

Opening a memory for sustained attention collapses the tree to a centered read:
- One column, wider measure; title at display size, body 17px.
- **Related memories gain snippets** — children + backlinks each show their
  first-line preview, already in the single `read` payload (no extra fetch).
- **Reversible** — `show tree` and the breadcrumb both return to Browse with the
  same memory selected. Drill is a focus mode, not a separate place.

## Data → UI mapping (build against these, nothing else)

| Surface | Call | Notes |
|---|---|---|
| Tree folder layer | `browse?kind=namespaces` | `{namespace,count}`; colon-split client-side |
| Folder leaves / Recent lens | `browse?kind=recent[&namespace=…]` | scoped → folder contents; unscoped → Recent |
| Hubs lens | `browse?kind=hubs` | render `in_degree` as primary metric |
| Orphans lens | `browse?kind=orphans` | prune candidates |
| Tags lens | `browse?kind=tags` | `{tag,count}`; selecting one filters (see Decisions) |
| Reading pane / drill | `read /:ns/:key` | memory + depth-1 `children[]`+`backlinks[]` w/ snippets |
| ⌘K search | `recall?q=…` | FTS over key/content/tags; hubs promoted in ranking |
| Prune | `DELETE` → `memory_delete` | refuses when backlinks exist unless `force=true` |

## Prune — the one write (guarded)

The only mutation in this UI. Out of read-only-API scope as defined in the
2026-06-05 spec, so it is an explicit, narrow addition:
- New session-auth endpoint `DELETE /api/memories/:ns/:key` → `store.del(ns, key,
  force)` (the store method exists). `?force=true` maps to the override.
- **Guardrail:** with backlinks, the store refuses; the UI must surface
  "N memories link here", list them, and require an explicit "delete anyway"
  (`force=true`). Without backlinks: single confirm, optimistic removal, undo
  toast.
- This keeps authoring out (no create/edit) while enabling the "prune the dust"
  verb on the Orphans lens.

## States & interactions

- **Tree loading:** counts arrive first; lazy-load leaves on first open with a
  quiet skeleton.
- **Empty store:** orient copy ("Agents haven't written anything here yet"), not
  an error. **Empty lens** (no orphans/hubs): say so warmly.
- **Dangling wikilink:** a `[[link]]` to a missing memory renders **muted &
  non-navigable** — never a dead-end click. (Requires parsing `[[…]]` in content
  and cross-referencing resolvable targets — see Decisions.)
- **Delete** (both paths above). **Search no results:** offer the nearest lens.
  **Session expired (401):** route to re-auth without losing the current address.
- **Keyboard:** `⌘K` search; `↑↓` move tree/results, `→←` expand/collapse;
  `↵` open in pane, again to drill; `esc` collapse drill / dismiss search.

## Decisions to confirm (real gaps, not yet resolved)

1. **Tag → list mechanism.** `browse?kind=tags` returns counts; the store has no
   "list memories with tag X" and `recall` requires a query string. Options:
   (a) extend `recall`/`browse` with a tag filter (small backend add), or
   (b) defer the Tags lens again. The spec wants it; recommend (a).
2. **Prune in this milestone or next?** It's the only write and adds a DELETE
   endpoint + confirm UI. Include now (spec lists it as a core verb) or ship
   orient+read first and add prune as a fast-follow. Recommend: build the read
   surfaces first, land prune immediately after (same milestone, last task).
3. **Inline wikilinks + dangling detection.** Rendering `[[…]]` inside body prose
   (vs. only the Links/Backlinks lists) and muting unresolved ones is new client
   parsing. Confirm it's in scope for v1 or a polish follow.
4. **⌘K palette** is a new floating component (the only elevation). In v1 or
   fast-follow?

## Phasing (proposed)

- **P1 — the shape:** full-viewport app shell (top bar / lens row / body split),
  client-side namespace tree with lazy leaves, the five lenses, split reading
  pane, address-as-route, full-page drill. Pure reads; reuses the existing API.
- **P2 — depth:** ⌘K palette, Tags lens (pending Decision 1), prune + guardrail,
  inline/dangling wikilinks, keyboard nav, the empty/loading/error states.

## Out of scope

Authoring (create/edit — stays on the agent/MCP path); constellation graph view;
namespace treemap; bulk prune. All parked per Ben's spec §10.

## Boundaries (module shape)

- Reuse `session.ts` + `browse-api.ts`; add only the `DELETE` handler for prune.
- `api.ts` gains `deleteMemory(ns,key,force)` and a typed namespace-list fetch.
- New client units, each one purpose: **namespace-tree builder** (pure: flat
  namespaces → folder tree), **`useBrowser` v2** (lens + tree expansion + route/
  selection state), **`TreePane`** (disclosure + lazy leaves), **`LensRow`**,
  **`Reader`** (split) / **`Drill`** (full-page) sharing a `read` payload,
  **`CommandPalette`** (⌘K). The tree builder is unit-testable in isolation and
  is where the colon-folding logic lives — keep it out of components.
