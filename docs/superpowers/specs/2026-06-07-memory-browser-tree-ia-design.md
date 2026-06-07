# Memory browser — filesystem-tree IA + Foundations grid — design

Date: 2026-06-07
Status: scoped to P1 after brainstorm (2026-06-07), pending plan

**Milestone (this spec's build target): P1 — "the shape."** Full-viewport app
shell, client-side namespace tree with lazy leaves, **four** working lenses
(Namespaces / Recent / Hubs / Orphans), split reading pane, address-as-route,
full-page drill. Pure reads against the existing API — **zero backend change.**
Everything else (⌘K palette, Tags lens, prune, inline/dangling wikilinks, full
state matrix) is P2. The brainstorm decisions are recorded in *Decisions* below.
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
populates the left pane; it never changes the layout.** **P1 ships four lenses:**

- **Namespaces** — the hierarchical tree (default).
- **Recent** — flat list by `updated_at` desc (`browse?kind=recent`).
- **Hubs** — by inbound link count (`browse?kind=hubs`, render `in_degree`).
- **Orphans** — no links in or out (`browse?kind=orphans`); prune candidates.
- **All** *(P2)* — the complete flat list of every memory (a "show me everything"
  list view), not capped to recent/hubs/orphans. See *P2 feedback* below.
- **Tags** *(P2)* — tag vocabulary with counts (`browse?kind=tags`); picking one
  filters the store. Needs a list-by-tag backend (see Decisions). Tags remain
  visible in the reader's tag row and full-text searchable in P1 regardless.

A running total (`248 memories · 14 namespaces`) pins to the right of the row.

Search stays in P1 as a working top-bar field bound to `recall` (results
populate the left pane). The ⌘K command-palette treatment of it is P2 — P1 does
not drop search, it just doesn't elevate it to a palette.

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
├ lens row ────────────────────────────────────  50px ┤  lenses · total pinned right
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
- **Lens row:** the lenses (four in P1) + running total.
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
| Tags lens *(P2)* | `browse?kind=tags` | `{tag,count}`; selecting one filters (needs list-by-tag) |
| Reading pane / drill | `read /:ns/:key` | memory + depth-1 `children[]`+`backlinks[]` w/ snippets |
| ⌘K search | `recall?q=…` | FTS over key/content/tags; hubs promoted in ranking |
| Prune *(P2)* | `DELETE` → `memory_delete` | refuses when backlinks exist unless `force=true` |

## Prune — the one write (guarded) *(P2)*

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

**P1 carries a minimal subset** — tree lazy-load skeleton, "select a memory"
empty reader, empty-store copy, existing 401→re-auth. The rest of the matrix
below (delete paths, dangling wikilinks, keyboard nav, per-lens empties) is **P2**.

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

## Decisions (resolved — brainstorm 2026-06-07)

1. **Milestone = P1 "the shape"** — tree IA + four lenses + split reader + drill +
   address-as-route + Foundations grid, pure reads. Everything below is P2.
2. **Tags lens → P2**, kept (not cut): tags are fully modelled (table, FTS index,
   `tagVocabulary`, `recall` tag filter) and stay visible/searchable in P1; the
   dedicated lens lands in P2 with the **list-by-tag backend** add (`recall`
   requires a query today, so "list all tagged X" needs a small extension).
3. **Prune → P2.** The only write; deferred out of P1 to keep it pure-read. P2
   adds `DELETE /api/memories/:ns/:key` + the backlink guardrail UI.
4. **Inline/dangling wikilinks → P2.** P1 renders body as text and shows the
   Links/Backlinks lists; parsing `[[…]]` inside prose and muting unresolved
   ones is P2.
5. **⌘K palette → P2.** P1 keeps the working top-bar search; the palette/keyboard
   treatment is P2.

## Phasing

- **P1 — the shape (this build):** full-viewport app shell (top bar with working
  search / four-lens row / body split), client-side namespace tree with lazy
  leaves, the four lenses, split reading pane (title = first content line),
  address-as-route, full-page drill. Pure reads; **no server change.**
- **P2 — depth:** ⌘K palette, Tags lens + list-by-tag backend, prune + guardrail,
  inline/dangling wikilinks, keyboard nav, the full empty/loading/error matrix.
  **Plus the P1 smoke-test feedback below** (All lens, chevron glyph fix, login
  redesign).

## P2 — feedback from the P1 smoke test (2026-06-07)

Ben drove the shipped P1 build and signed off ("looks great"). Three items to
fold into P2, in priority order:

1. **"All" lens — a complete flat list view.** *(new lens; was a P1 gap.)* There
   is no easy way to see *every* memory — Recent caps at the latest by
   `updated_at`, Hubs/Orphans are filtered subsets, and the tree only reveals a
   namespace's leaves once opened. Add an **All** lens that lists every memory.
   - **Data:** the read API has no `kind=all`. Two options — (a) reuse
     `browse?kind=recent` with a high `limit` (orders by `updated_at`, "dumbest
     thing that works"); or (b) add a small backend ordering option so All can
     sort **alphabetically by address** (`namespace`, then `key`) for a stable,
     scannable list. Recommend (b) — a list of "everything" reads best
     alphabetically, and the same backend touch can serve the Tags list-by-X
     work. Decide at plan time; if (a), document the `updated_at` ordering and
     the cap.
   - **UI:** reuses the existing flat-list `MemoryRow` path in `TreePane`; lands
     in `LensRow` as a fifth lens. No new component.

2. **Disclosure chevron renders poorly.** *(polish bug, deferred to P2 per Ben.)*
   The folder arrow is a Unicode glyph (`▸` U+25B8) at `font-size: 9px`, rotated
   90° on open. At that size the glyph renders thin, inconsistently weighted, and
   slightly misaligned across the rows (visible in Ben's screenshot). **Fix:**
   replace the text glyph with a crisp **inline SVG chevron** (a single stroked
   path, `currentColor`, ~10px) rotated via the existing `.chev--open`
   transform — or, if avoiding SVG, a CSS border-triangle. Keep the open/closed
   rotation and the muted→`ink-3` color shift. Purely `TreePane.tsx` +
   `styles.css`; no logic change.

3. **Login screen redesign.** *(known-ugly; deferred.)* The `/sign-in` screen is
   a bare "memory-fs" title + a plain full-width "Continue with Google" button,
   top-aligned on an empty canvas (it still uses the generic auth `Shell`). Give
   it the Foundations treatment: vertically centered card, product wordmark +
   one line of framing copy ("Shared memory for your agents" or similar — defer
   exact copy to brand voice), a properly-sized Google button, warm-paper
   background. Touches `SignIn.tsx` (and the auth-screen CSS); no auth-flow
   change — purely presentational. Same pass can tidy the `…` pending state.

## Out of scope

Authoring (create/edit — stays on the agent/MCP path); constellation graph view;
namespace treemap; bulk prune. All parked per Ben's spec §10.

## Boundaries (module shape)

**P1** — `session.ts` + `browse-api.ts` reused **unchanged** (no server work).
`api.ts` gains a typed namespace-list fetch (and reuses the existing `read` /
`recall`). New client units, each one purpose:

- **`namespaceTree`** — pure: flat `{namespace,count}[]` → folder tree by
  colon-folding. The real logic; unit-tested in isolation, kept out of components.
- **`useBrowser` v2** — lens, tree-expansion map, selected address, reader/drill
  mode, query, route sync.
- **`TopBar`** (wordmark · working search · account) · **`LensRow`** (four lenses
  + running total) · **`TreePane`** (disclosure + lazy leaves; flat-list for
  Recent/Hubs/Orphans; results for search) · **`Reader`** (split) / **`Drill`**
  (full-page) sharing one `read` payload via a `mode` toggle.
- Replaces today's `Facets`/`MemoryList`; `MemoryDetail` → `Reader`.

**P2 adds** — a `DELETE` handler in `browse-api.ts` + `api.deleteMemory(ns,key,
force)` (prune); the list-by-tag backend + Tags lens; a `CommandPalette` (⌘K);
wikilink parsing in the reader.
