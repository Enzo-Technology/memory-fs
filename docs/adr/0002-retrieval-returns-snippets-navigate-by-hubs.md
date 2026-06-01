# Retrieval routes return content snippets; navigate by hub-notes, not key listings

Every memory-fs route that returns memory **records** includes a content
`snippet`. The only routes allowed to return bare identifiers are the
**vocabulary views** (`tags`, `namespaces`) — explicitly structural "show me the
shape of the store" queries. No other route hands back a key/slug that forces a
follow-up `read`.

This is paired with a granularity stance: **atomic notes are the default unit**,
composed into areas via `[[wikilinks]]` and **hub-notes**, not accumulated into
longform documents. Snippets are cheap and meaningful precisely *because* notes
are atomic — the first line is effectively the summary, so no LLM-generated
summary field is needed.

## Invariant (enforce as a fitness function)

> Every route returning memory records includes a non-empty `snippet`. The only
> identifier-only routes are the vocabulary views (`tags`, `namespaces`).

A regression test asserts this: every `BrowseResult` item (except `kind:'tags'`
and `kind:'namespaces'`), every `Backlink`, and every `NearDuplicate` carries a
`snippet`. This test is the gate that keeps a future restructure from quietly
regressing the ergonomic.

## Considered options

- **Snippet on every record route (chosen)** — eliminates the "list then read
  each" N+1 round-trip everywhere. Costs ~160 chars per item; negligible at
  atomic sizes. Deepens existing return types instead of widening the tool
  surface.
- **Keys-only listings + follow-up `read`** (status quo) — what `recent`,
  `hubs`, `orphans`, `backlinks`, and `near_duplicate_warning` do today. Forces a
  blind second call on every item; `backlinks` in particular contradicts its own
  "more useful than recall for understanding a topic" pitch by returning bare
  slugs.
- **Stored LLM `summary` field** — rejected. Adds a write-time model call and a
  field that drifts. Atomicity already makes the first line a summary; revisit
  only if snippets prove too thin (itself a signal a note has bloated).
- **Namespace-prefix match / "dump all content under a scope"** — rejected.
  Invites context-dumps and grows the surface. The intended "read a whole area"
  path is hub-note + `[[links]]` + `backlinks`, which already exists.

## Decisions this bundles

- **`browse kind:'namespaces'`** — new vocabulary view, `{namespace, count}`,
  symmetric with `tags`. The one sanctioned "just show me identifiers" route.
- **`read` returns the local neighbourhood** — the note plus its outbound links
  (children) and inbound links (backlinks), each with a snippet, **bounded**
  (depth 1, cap ~20, ordered). Reading a hub returns its children in one call.
  Always-on and bounded rather than behind a `with_links` mode flag.
- **Hub-ness is derived, not stored** — computed from the `links` table
  (out-links = children, in-links = backlinks). No `is_hub` column to drift.
  Convention: child notes link back to their parent hub, which gives the hub
  in-degree so the existing `hubs` view and `backlinks` surface it without new
  out-degree/MOC detection.
- **Atomicity forcing function** — a non-blocking `size_warning` on write when
  `content` exceeds a threshold and `type !== 'reference'`, nudging "split into
  linked atomic notes." `reference` is the explicit longform escape hatch.
- **No `memory_edit`** — atomic notes update by full overwrite (`memory_note`,
  `on_conflict:'overwrite'`), mirroring mem0's `update_memory`. Partial
  find/replace is only needed for longform docs, which we decompose instead. A
  shared-store lost-update guard is an optional `expected_updated_at` on
  `memory_note`, not a new tool.
- **Tool-description guidance** — `memory_note`/`recall`/`read` descriptions
  steer agents toward writing hub-notes and multi-memory retrieval, since for
  agents the tool description *is* the interface.

## Consequences

- Tool count stays at 7. Every change here *deepens* an existing tool or enriches
  a return type; none widens the surface. This is deliberate — the shared,
  namespaced, snippet-bearing interface is the product's wedge, so the interface
  stays small and coherent rather than growing capabilities.
- Listings get larger payloads (snippet per item). Bounded by `limit` and atomic
  note sizes; revisit only if payloads become a measured problem.
- The store does not optimise for "load an entire namespace's content." If an
  agent wants that, the signal is that the content should have a hub entry point,
  not be scattered atoms — see the granularity stance above.
