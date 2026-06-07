# Memory browser P2 — smoke-test feedback batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the three P1 smoke-test findings — add an "All" lens (complete list view), replace the poorly-rendering disclosure-chevron glyph with a crisp inline SVG, and redesign the bare `/sign-in` screen — without touching the backend.

**Architecture:** All three are client-only. The "All" lens reuses the existing flat-list path: fetch `browse?kind=recent` at a high limit and sort the rows alphabetically by address (`namespace`, then `key`) with a new pure `sortByAddress` util (zero backend change — for a team-scale store this is the dumbest thing that works). The chevron becomes an inline SVG rotated by the existing `.chev--open` transform. The sign-in screen gets a dedicated centered Foundations card in `SignIn.tsx` + new auth CSS; the OAuth flow is untouched.

**Tech Stack:** React 19 + Vite (esbuild), TypeScript, plain CSS with the existing Foundations tokens. Pure logic tested with Vitest under `tests/`.

---

## Conventions & gotchas (read before starting)

- **No backend change.** `src/**` is not touched by any task. The "All" lens is pure client work over the existing `browse?kind=recent` endpoint.
- **The UI is bundled by esbuild (Vite), which does NOT typecheck**, and `@types/react` is not installed — so do NOT run `tsc -p ui`. UI verification is `npm run build:ui` (catches import/syntax/bundling errors) plus the manual browser check at the end. Pure-logic modules carry real Vitest unit tests.
- **Pure-module tests live under `tests/`** (Vitest's `include` is `tests/**/*.test.ts`) and import across into `ui/src` with a `.js` extension on the import specifier (e.g. `../ui/src/sortRows.js`) — the established convention; type-only imports are erased at transform time.
- **Existing P1 code these tasks build on:** `ui/src/api.ts` exports `Lens`/`FlatLens`/`listMemories`/`listNamespaces`; `ui/src/useBrowser.ts` exports `useBrowser`/`Row`/`Mode`/`BrowserView` and has the flat-lens effect; `ui/src/LensRow.tsx` renders the lens buttons; `ui/src/TreePane.tsx` has `paneTitle` + `FolderRow` (the chevron) + the flat `MemoryRow`; `ui/src/SignIn.tsx` renders the auth screen via the generic `Shell`.
- **Branch note:** a concurrent process is committing CD/eval work to this same branch. Use targeted `git add <files>` (never `git add -A`) so unrelated in-flight changes aren't swept into these commits.

## File structure

- `ui/src/sortRows.ts` — **new**, pure: sort rows by `(namespace, key)`. Test: `tests/sort-rows.test.ts`.
- `ui/src/api.ts` — `Lens` gains `"all"`; `listMemories` gains an optional `limit`.
- `ui/src/useBrowser.ts` — flat-lens effect handles `"all"` (fetch recent at high limit + `sortByAddress`).
- `ui/src/LensRow.tsx` — add the "All" lens button.
- `ui/src/TreePane.tsx` — `paneTitle` gains `"all"`; `FolderRow` chevron glyph → inline SVG.
- `ui/src/SignIn.tsx` — dedicated centered sign-in card for the not-signed-in state.
- `ui/src/styles.css` — chevron rule update (drop `font-size` glyph hack); append `.signin*` rules.

---

## Task 1: `sortByAddress` — pure address sort (TDD)

**Files:**
- Create: `ui/src/sortRows.ts`
- Test: `tests/sort-rows.test.ts`

Generic over `{ namespace, key }` so the test needs no React import (keeps it a clean pure unit). Used by the "All" lens in Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/sort-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortByAddress } from "../ui/src/sortRows.js";

describe("sortByAddress", () => {
  it("orders by namespace, then key", () => {
    const rows = [
      { namespace: "b", key: "x" },
      { namespace: "a", key: "z" },
      { namespace: "a", key: "a" },
    ];
    expect(sortByAddress(rows).map((r) => `${r.namespace}/${r.key}`)).toEqual([
      "a/a",
      "a/z",
      "b/x",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { namespace: "b", key: "x" },
      { namespace: "a", key: "y" },
    ];
    const before = [...rows];
    sortByAddress(rows);
    expect(rows).toEqual(before);
  });

  it("returns [] for []", () => {
    expect(sortByAddress([])).toEqual([]);
  });

  it("preserves extra fields on the rows", () => {
    const rows = [
      { namespace: "a", key: "b", type: "note", snippet: "hi" },
      { namespace: "a", key: "a", type: "user", snippet: "yo" },
    ];
    expect(sortByAddress(rows)[0]).toEqual({
      namespace: "a",
      key: "a",
      type: "user",
      snippet: "yo",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sort-rows.test.ts`
Expected: FAIL — cannot resolve `../ui/src/sortRows.js`.

- [ ] **Step 3: Write the implementation**

Create `ui/src/sortRows.ts`:

```ts
// Sort memory rows alphabetically by address (namespace, then key). Pure and non-mutating —
// returns a new array. Used by the "All" lens to present a complete, stably-ordered list. Generic
// over the address shape so it carries no React dependency (unit-tested in isolation).
export function sortByAddress<T extends { namespace: string; key: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sort-rows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/sortRows.ts tests/sort-rows.test.ts
git commit -m "feat(ui): sortByAddress util for the All lens"
```

---

## Task 2: The "All" lens

**Files:**
- Modify: `ui/src/api.ts`
- Modify: `ui/src/useBrowser.ts`
- Modify: `ui/src/LensRow.tsx`
- Modify: `ui/src/TreePane.tsx`

A complete list of every memory, ordered alphabetically by address. Reuses the flat-list renderer; the only data trick is fetching `recent` at a high limit and client-sorting.

- [ ] **Step 1: Add `"all"` to the `Lens` type and an optional `limit` to `listMemories`**

In `ui/src/api.ts`, change:

```ts
export type FlatLens = "recent" | "hubs" | "orphans";
export type Lens = "namespaces" | FlatLens;
```

to:

```ts
export type FlatLens = "recent" | "hubs" | "orphans";
export type Lens = "namespaces" | "all" | FlatLens;
```

and change:

```ts
export function listMemories(kind: FlatLens, namespace?: string): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind, limit: "100" });
  if (namespace) p.set("namespace", namespace);
  return get<BrowseResult>(`/api/memories?${p.toString()}`);
}
```

to:

```ts
export function listMemories(
  kind: FlatLens,
  namespace?: string,
  limit = 100,
): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind, limit: String(limit) });
  if (namespace) p.set("namespace", namespace);
  return get<BrowseResult>(`/api/memories?${p.toString()}`);
}
```

- [ ] **Step 2: Handle `"all"` in the flat-lens effect of `useBrowser`**

In `ui/src/useBrowser.ts`, first add the import near the other local imports (next to the `./route` / `./namespaceTree` imports):

```ts
import { sortByAddress } from "./sortRows";
```

Then replace the entire flat-lens effect — find this block:

```ts
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
```

and replace it with:

```ts
  // 2. Flat lens list. Skipped for the tree lens and while searching. "all" reuses the recent
  //    endpoint at a high limit and sorts client-side by address — a complete, stably-ordered
  //    list with no backend change (fine at team scale; see plan note on the cap).
  useEffect(() => {
    if (query.trim() || lens === "namespaces") {
      setFlat(null);
      return;
    }
    let live = true;
    setFlat(null);
    const load =
      lens === "all"
        ? listMemories("recent", undefined, 1000).then((b) => ({
            rows: sortByAddress(toRows(b)),
            total: b.total,
          }))
        : listMemories(lens as FlatLens).then((b) => ({
            rows: toRows(b),
            total: b.total,
          }));
    load.then(({ rows, total }) => {
      if (!live) return;
      setFlat(rows);
      setTotals((t) => ({ ...t, memories: total }));
    });
    return () => {
      live = false;
    };
  }, [lens, query]);
```

- [ ] **Step 3: Add the "All" lens button**

In `ui/src/LensRow.tsx`, change:

```ts
const LENSES: { id: Lens; label: string }[] = [
  { id: "namespaces", label: "Namespaces" },
  { id: "recent", label: "Recent" },
  { id: "hubs", label: "Hubs" },
  { id: "orphans", label: "Orphans" },
];
```

to (note: "All" sits right after the tree, as the obvious "show me everything" companion):

```ts
const LENSES: { id: Lens; label: string }[] = [
  { id: "namespaces", label: "Namespaces" },
  { id: "all", label: "All" },
  { id: "recent", label: "Recent" },
  { id: "hubs", label: "Hubs" },
  { id: "orphans", label: "Orphans" },
];
```

- [ ] **Step 4: Add the `"all"` pane title**

In `ui/src/TreePane.tsx`, change:

```ts
function paneTitle(lens: Lens, query: string): string {
  if (query.trim()) return "Results";
  return { namespaces: "Namespaces", recent: "Recent", hubs: "Hubs", orphans: "Orphans" }[lens];
}
```

to:

```ts
function paneTitle(lens: Lens, query: string): string {
  if (query.trim()) return "Results";
  return { namespaces: "Namespaces", all: "All", recent: "Recent", hubs: "Hubs", orphans: "Orphans" }[lens];
}
```

(`emptyLensMessage` needs no change — `"all"` falls through to its default "Nothing here yet.", which only shows on a genuinely empty store.)

- [ ] **Step 5: Verify the bundle is green**

Run: `npm run build:ui`
Expected: SUCCESS, no errors.

Run: `npx vitest run tests/sort-rows.test.ts tests/route.test.ts tests/namespace-tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api.ts ui/src/useBrowser.ts ui/src/LensRow.tsx ui/src/TreePane.tsx
git commit -m "feat(ui): All lens — complete list, alphabetical by address"
```

---

## Task 3: Crisp disclosure chevron (SVG)

**Files:**
- Modify: `ui/src/TreePane.tsx`
- Modify: `ui/src/styles.css`

The `▸` (U+25B8) glyph at `font-size: 9px` renders thin and inconsistently. Replace it with a stroked inline SVG chevron (uses `currentColor`, rotates 90° on open via the existing `.chev--open` rule).

- [ ] **Step 1: Replace the chevron glyph in `FolderRow`**

In `ui/src/TreePane.tsx`, find:

```tsx
      <button className="trow trow--folder" style={indent} onClick={() => onToggle(node)}>
        <span className={isOpen ? "chev chev--open" : "chev"}>{expandable ? "▸" : ""}</span>
        <span className="trow__name">{node.name}</span>
        <span className="trow__count">{node.total}</span>
      </button>
```

and replace it with:

```tsx
      <button className="trow trow--folder" style={indent} onClick={() => onToggle(node)}>
        <span className={isOpen ? "chev chev--open" : "chev"}>
          {expandable && (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path
                d="M4.5 2.5 L8 6 L4.5 9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span className="trow__name">{node.name}</span>
        <span className="trow__count">{node.total}</span>
      </button>
```

- [ ] **Step 2: Update the `.chev` CSS to center the SVG (drop the glyph font-size hack)**

In `ui/src/styles.css`, find:

```css
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
```

and replace it with:

```css
.chev {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-4);
  transition: transform 0.12s ease;
}
.chev--open {
  transform: rotate(90deg);
  color: var(--ink-3);
}
```

- [ ] **Step 3: Verify the bundle is green**

Run: `npm run build:ui`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/TreePane.tsx ui/src/styles.css
git commit -m "fix(ui): crisp inline-SVG disclosure chevron (was a 9px glyph)"
```

---

## Task 4: Sign-in screen redesign

**Files:**
- Modify: `ui/src/SignIn.tsx`
- Modify: `ui/src/styles.css`

Replace the bare title + default-styled button (top-aligned on an empty canvas) with a vertically-centered Foundations card: wordmark, one line of framing copy, and a properly-sized Google button with the Google "G" glyph. The OAuth flow, the pending/already-signed-in states, and `Shell` are untouched — only the not-signed-in screen changes.

> **Copy note:** the tagline below ("Shared memory for your agents.") is a reasonable provisional line; Ben/brand voice may tweak the wording — it's isolated to one element.

- [ ] **Step 1: Rewrite the not-signed-in return + add the Google glyph in `SignIn.tsx`**

In `ui/src/SignIn.tsx`, find the final return (the not-signed-in case):

```tsx
  // Not signed in. callbackURL resumes the OAuth flow if we're mid-authorize, else
  // lands on the app home.
  const callbackURL = resume ?? "/";
  return (
    <Shell>
      <button
        onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
      >
        Continue with Google
      </button>
    </Shell>
  );
}
```

and replace it with:

```tsx
  // Not signed in. callbackURL resumes the OAuth flow if we're mid-authorize, else
  // lands on the app home. Dedicated centered card (not the generic Shell) so the entry
  // screen gets the Foundations treatment.
  const callbackURL = resume ?? "/";
  return (
    <main className="signin">
      <div className="signin__card">
        <div className="signin__wordmark">memory-fs</div>
        <p className="signin__tagline">Shared memory for your agents.</p>
        <button
          className="signin__google"
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
        >
          <GoogleGlyph />
          Continue with Google
        </button>
      </div>
    </main>
  );
}

// The Google "G" mark — inline so the button needs no asset pipeline.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
```

(Leave the imports, the `useEffect` resume logic, the `isPending` branch, and the already-signed-in branch exactly as they are — they keep using `Shell`.)

- [ ] **Step 2: Append the sign-in card styles**

At the END of `ui/src/styles.css`, append:

```css
/* ---------- sign-in screen ---------- */
.signin {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--paper);
  padding: var(--s-5);
}
.signin__card {
  width: 100%;
  max-width: 360px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--s-7) var(--s-6);
  display: grid;
  justify-items: center;
  text-align: center;
  gap: var(--s-2);
}
.signin__wordmark {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.signin__tagline {
  margin: 0 0 var(--s-4);
  font-size: 14px;
  color: var(--ink-3);
}
.signin__google {
  width: 100%;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  background: var(--surface);
  border: 1px solid var(--hairline-2);
  border-radius: var(--r-md);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.signin__google:hover {
  background: var(--fill);
}
```

- [ ] **Step 3: Verify the bundle is green**

Run: `npm run build:ui`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/SignIn.tsx ui/src/styles.css
git commit -m "feat(ui): redesign the sign-in screen (centered Foundations card)"
```

---

## Task 5: Full build + verification

- [ ] **Step 1: Full build (UI bundle + server typecheck)**

Run: `npm run build`
Expected: `vite build ui` succeeds AND `tsc` (server, `src/**`) succeeds with no errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all green — server suite (54) + route (4) + namespace-tree (6) + sort-rows (4) = 68.

- [ ] **Step 3: Manual browser check** (`npm run dev`, sign in)

- [ ] Sign-in screen is a centered card with wordmark, tagline, and a Google-glyph button on warm paper (not the old bare top-aligned button).
- [ ] After sign-in, the lens row shows **All** between Namespaces and Recent; selecting it lists every memory ordered alphabetically by `namespace` then `key`; the running total matches.
- [ ] Folder disclosure chevrons render crisply (clean triangle, consistent weight/alignment), point right when closed and down when open, and animate on toggle.
- [ ] Existing lenses (Recent/Hubs/Orphans), the tree, search, open, and drill still work unchanged.

- [ ] **Step 4: Final commit (only if the check prompted fixes)**

```bash
git add -- ui/src
git commit -m "fix(ui): address findings from P2 smoke check"
```

(Skip if nothing needed fixing. Note the explicit `-- ui/src` pathspec — do not `git add -A` on this shared branch.)

---

## Self-review notes

- **Spec coverage** (the three P2-feedback items in `docs/superpowers/specs/2026-06-07-memory-browser-tree-ia-design.md` → "P2 — feedback from the P1 smoke test"): All lens → Tasks 1–2; chevron fix → Task 3; login redesign → Task 4. Verification → Task 5.
- **Scope discipline:** only these three items. The rest of P2 (⌘K palette, Tags lens + list-by-tag backend, prune + guardrail, inline/dangling wikilinks, keyboard nav, full error matrix) is intentionally NOT in this plan.
- **No backend change:** no task touches `src/**`. The "All" lens decision is the zero-backend client-sort approach; the 1000-row cap is acceptable at team scale (documented in the effect comment) — backend paging is a later add if the store outgrows it.
- **Type consistency:** `Lens` gains `"all"` in api.ts (Task 2 Step 1) and is consumed consistently in `LensRow` (Step 3) and `TreePane.paneTitle` (Step 4); `listMemories`'s new `limit` param is used by the "all" branch in useBrowser (Step 2); `sortByAddress` (Task 1) is imported and used in useBrowser (Task 2 Step 2). The chevron `.chev`/`.chev--open` class names are unchanged, so the rotation keeps working.
```
