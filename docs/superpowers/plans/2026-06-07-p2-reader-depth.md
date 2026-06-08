# Reader Depth (wikilinks + state matrix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two P2 "reader depth" items from the memory-browser tree-IA spec — (#4) inline/dangling wikilinks rendered in the reading pane, and (#6) the empty/loading/error state matrix — plus 401-preserves-the-address so a session expiry returns the user to the exact memory they were reading. Pure client work; **no server change.**

**Architecture:** A new pure client tokenizer (`ui/src/wikilinkText.ts`) mirrors the server's `src/core/wikilinks.ts` tokenizing rules and is unit-tested in isolation under `tests/`. `Reader.tsx` renders the memory body from those tokens, deciding link resolvability against the read payload's `children[]` (dangling targets are omitted server-side). `useBrowser.ts` gains three error flags so a failed fetch surfaces an error instead of an infinite skeleton; `TreePane.tsx` and `Reader.tsx` render that error copy. `api.ts` + `SignIn.tsx` + `auth.ts` cooperate to carry a `?next=` address through re-auth.

**Tech Stack:** React 19 + TypeScript, bundled by Vite/esbuild (no typecheck at bundle time). Vitest for pure-logic tests. Better Auth (Google social) for the auth flow. Existing Foundations CSS in `ui/src/styles.css`.

---

## Conventions & gotchas

- **UI is bundled by esbuild (via Vite) which does NOT typecheck**, and `@types/react` is NOT installed. **Do NOT run `tsc -p ui`.** UI verification = `npm run build:ui`. Full server typecheck = `npm run build` (runs `vite build ui && tsc`). Full test run = `npx vitest run`.
- **Pure-logic tests live under `tests/`** (Vitest `include` = `tests/**/*.test.ts`). To import a unit from `ui/src` into a test, use a `.js` specifier (e.g. `import { tokenize } from "../ui/src/wikilinkText.js";`). Type-only imports are erased at runtime, so `import type { Token } from "../ui/src/wikilinkText.js"` is fine. This is the pattern already used by `tests/namespace-tree.test.ts` and `tests/sort-rows.test.ts`.
- **Run a single test file** with `npx vitest run tests/<file>.test.ts`.
- **Shared working tree:** a concurrent agent runs `git checkout` on this tree. Commit steps must commit to the CURRENT branch (`feat/oauth-better-auth`). **Do NOT run `git checkout` / `git switch` / `git branch`.** Use **targeted** `git add <files>` — **never `git add -A`** (you'd sweep up the other agent's work).
- **Commit message footer** (required by CLAUDE.md):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Mirror the server tokenizer exactly** (`src/core/wikilinks.ts`): the four regexes (`FENCE`, `INLINE_CODE`, `TRIPLE`, `LINK`) and the `ns:key` / `ns/key` / default-namespace resolution logic are the source of truth. The difference: the server *strips* code/triple regions then extracts refs; the client tokenizer must *emit those regions as text tokens* (so the body renders unchanged), and must NOT dedup (every occurrence renders in place).
- **Resolvability is the Reader's job, not the tokenizer's.** The tokenizer only classifies text vs link and resolves the link's `(namespace, key)`. Whether a link is dangling is decided in `Reader.tsx` by checking membership in the read payload's `children[]` set.
- **CLAUDE.md discipline:** dumbest thing that works; three similar lines is fine; validate at boundaries, trust internal invariants. The error surface stays minimal (booleans, one-line copy), no retry machinery beyond what's specified.

## File structure

```
ui/src/
  wikilinkText.ts      CREATE — pure tokenizer: tokenize(content, defaultNamespace): Token[]
  Reader.tsx           MODIFY — render body from tokens; resolvable vs dangling links; loading/error copy
  useBrowser.ts        MODIFY — flatError/resultsError/detailError flags on BrowserView; .catch on the 3 fetches
  Browser.tsx          MODIFY — pass the new error flags + loading state through to TreePane/Reader
  TreePane.tsx         MODIFY — render "Couldn't load — retry?" on error instead of the skeleton
  api.ts               MODIFY — 401 redirect carries ?next=<current address>
  SignIn.tsx           MODIFY — callbackURL honours ?next=
  auth.ts              READ ONLY — confirm authorizeResume()/callbackURL contract (no edit expected)
  styles.css           MODIFY — .wikilink / .wikilink--dangling; .reader error/loading copy; .tree error copy
tests/
  wikilink-text.test.ts  CREATE — strict TDD for the tokenizer
```

---

## Task 1: Pure wikilink tokenizer (`wikilinkText.ts`) — strict TDD

The real logic of this plan. Tokenize a memory body into ordered text/link tokens, mirroring `src/core/wikilinks.ts` but emitting code/triple regions as text (not stripping them) and preserving every occurrence (no dedup).

**Files:**
- `tests/wikilink-text.test.ts` — Test (Create)
- `ui/src/wikilinkText.ts` — Create

- [ ] Write the failing test file `tests/wikilink-text.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { tokenize, type Token } from "../ui/src/wikilinkText.js";

  describe("tokenize", () => {
    const ns = "project:enzo";

    it("returns a single text token for plain content", () => {
      expect(tokenize("just prose, no links", ns)).toEqual<Token[]>([
        { kind: "text", text: "just prose, no links" },
      ]);
    });

    it("splits a single link out of surrounding text, preserving it exactly", () => {
      expect(tokenize("see [[auth-decision]] now", ns)).toEqual<Token[]>([
        { kind: "text", text: "see " },
        { kind: "link", raw: "auth-decision", namespace: ns, key: "auth-decision" },
        { kind: "text", text: " now" },
      ]);
    });

    it("resolves the ns:key form", () => {
      expect(tokenize("[[voice:errors/tone]]", ns)).toEqual<Token[]>([
        { kind: "link", raw: "voice:errors/tone", namespace: "voice:errors", key: "tone" },
      ]);
    });

    it("uses the default namespace for a bare key (ns/key form)", () => {
      expect(tokenize("[[notes/a]]", ns)).toEqual<Token[]>([
        { kind: "link", raw: "notes/a", namespace: ns, key: "notes/a" },
      ]);
    });

    it("leaves a [[link]] inside a fenced code block as text", () => {
      const md = "before ```\n[[ignored]]\n``` after [[real]]";
      expect(tokenize(md, ns)).toEqual<Token[]>([
        { kind: "text", text: "before ```\n[[ignored]]\n``` after " },
        { kind: "link", raw: "real", namespace: ns, key: "real" },
      ]);
    });

    it("leaves a [[link]] inside inline code as text", () => {
      expect(tokenize("`[[inline]]` and [[real]]", ns)).toEqual<Token[]>([
        { kind: "text", text: "`[[inline]]` and " },
        { kind: "link", raw: "real", namespace: ns, key: "real" },
      ]);
    });

    it("leaves a [[[triple]]] escape form as text", () => {
      expect(tokenize("literal [[[notwiki]]] here", ns)).toEqual<Token[]>([
        { kind: "text", text: "literal [[[notwiki]]] here" },
      ]);
    });

    it("emits every occurrence of the same link (no dedup, unlike the server)", () => {
      expect(tokenize("[[x]] [[x]]", ns)).toEqual<Token[]>([
        { kind: "link", raw: "x", namespace: ns, key: "x" },
        { kind: "text", text: " " },
        { kind: "link", raw: "x", namespace: ns, key: "x" },
      ]);
    });
  });
  ```
- [ ] Run `npx vitest run tests/wikilink-text.test.ts` — expect **FAIL** (module `../ui/src/wikilinkText.js` does not exist yet → "Failed to resolve import" / "Cannot find module").
- [ ] Create `ui/src/wikilinkText.ts`:
  ```ts
  // Pure client tokenizer for the reading pane. Splits a memory body into ordered text/link tokens
  // so Reader can render prose unchanged while making wikilinks navigable. Mirrors the tokenizing
  // rules of src/core/wikilinks.ts (no linkifying inside ```fences```, `inline code`, or [[[triple]]]
  // escapes; ns:key / ns/key / default-namespace resolution) — but emits those skipped regions as
  // text (so the body is preserved) and does NOT dedup (every occurrence renders in place).
  // Resolvability (dangling vs navigable) is decided in Reader, not here.

  export type Token =
    | { kind: "text"; text: string }
    | { kind: "link"; raw: string; namespace: string; key: string };

  // Regions where [[...]] must NOT be treated as a link. Mirrors src/core/wikilinks.ts.
  const SKIP = /```[\s\S]*?```|`[^`\n]*`|\[\[\[[^\]]*\]\]\]/g;
  const LINK = /\[\[([^\[\]\n]+?)\]\]/g;

  // Split raw `[[ inner ]]` text into (namespace, key). ns:key wins over ns/key when the colon comes
  // first; otherwise the whole thing is a key in the default namespace. Identical to the server.
  function resolve(raw: string, defaultNamespace: string): { namespace: string; key: string } {
    const colon = raw.indexOf(":");
    const slash = raw.indexOf("/");
    if (colon !== -1 && (slash === -1 || colon < slash)) {
      const cut = raw.indexOf("/", colon);
      if (cut === -1) return { namespace: raw.slice(0, colon), key: raw.slice(colon + 1) };
      return { namespace: raw.slice(0, cut), key: raw.slice(cut + 1) };
    }
    return { namespace: defaultNamespace, key: raw };
  }

  // Tokenize the part of `content` between [start, end) that is known to be link-eligible (no skip
  // regions). Pushes text/link tokens onto `out`. Empty/invalid brackets fall through as text.
  function tokenizeRegion(
    content: string,
    start: number,
    end: number,
    defaultNamespace: string,
    out: Token[],
  ): void {
    LINK.lastIndex = start;
    let cursor = start;
    let m: RegExpExecArray | null;
    while ((m = LINK.exec(content)) !== null && m.index < end) {
      const raw = m[1]!.trim();
      const { namespace, key } = resolve(raw, defaultNamespace);
      if (!namespace.trim() || !key.trim()) continue; // empty bracket → leave as text
      if (m.index > cursor) out.push({ kind: "text", text: content.slice(cursor, m.index) });
      out.push({ kind: "link", raw, namespace: namespace.trim(), key: key.trim() });
      cursor = m.index + m[0].length;
    }
    if (cursor < end) out.push({ kind: "text", text: content.slice(cursor, end) });
  }

  export function tokenize(content: string, defaultNamespace: string): Token[] {
    const out: Token[] = [];
    let cursor = 0;
    SKIP.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = SKIP.exec(content)) !== null) {
      // Link-eligible text before this skip region.
      tokenizeRegion(content, cursor, s.index, defaultNamespace, out);
      // The skip region itself is emitted verbatim as text.
      out.push({ kind: "text", text: s[0] });
      cursor = s.index + s[0].length;
    }
    tokenizeRegion(content, cursor, content.length, defaultNamespace, out);
    return out;
  }
  ```
- [ ] Run `npx vitest run tests/wikilink-text.test.ts` — expect **PASS** (8 passed).
- [ ] Verify the bundle still builds: `npm run build:ui` — expect it to finish with no errors (esbuild prints the output bundle sizes).
- [ ] Commit:
  ```
  git add ui/src/wikilinkText.ts tests/wikilink-text.test.ts
  git commit -m "feat(ui): pure client wikilink tokenizer for the reader

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: Render the body from tokens in `Reader.tsx`

Replace the plain `<pre>{detail.content}</pre>` with token-driven children: navigable green buttons for resolvable links, muted non-interactive spans for dangling ones, text otherwise. The title (firstLine) stays plain.

**Files:**
- `ui/src/Reader.tsx` — Modify
- `ui/src/styles.css` — Modify

- [ ] In `ui/src/Reader.tsx`, add the tokenizer import next to the existing imports. Old:
  ```tsx
  import type { ReadResult } from "../../src/core/store";
  import type { Mode } from "./useBrowser";
  import { TYPE_COLOR } from "./memoryType";
  ```
  New:
  ```tsx
  import type { ReadResult } from "../../src/core/store";
  import type { Mode } from "./useBrowser";
  import { TYPE_COLOR } from "./memoryType";
  import { tokenize, type Token } from "./wikilinkText";
  ```
- [ ] Replace the body line. Old:
  ```tsx
        <h1 className="reader__title">{title}</h1>
        <pre className="reader__content">{detail.content}</pre>
  ```
  New:
  ```tsx
        <h1 className="reader__title">{title}</h1>
        <Body detail={detail} onNavigate={onNavigate} />
  ```
- [ ] Add the `Body` component immediately after the `Reader` function's closing brace (before the `Neighbours` function). It tokenizes the content with the memory's own namespace as the default, and resolves each link against the set of existing outbound targets (dangling targets are omitted from `children` server-side):
  ```tsx
  // The memory body, rendered from wikilink tokens so [[links]] become navigable. A link resolves
  // iff its (namespace,key) is an existing outbound child — dangling targets are omitted from the
  // read payload's children server-side, so anything not in that set is muted and non-navigable
  // (never a dead-end click). Text tokens render verbatim; the <pre> preserves whitespace.
  function Body({
    detail,
    onNavigate,
  }: {
    detail: ReadResult;
    onNavigate: (namespace: string, key: string) => void;
  }) {
    const tokens = tokenize(detail.content, detail.namespace);
    const resolvable = new Set(detail.children.map((c) => `${c.namespace}\x00${c.key}`));
    return (
      <pre className="reader__content">
        {tokens.map((t, i) => renderToken(t, i, resolvable, onNavigate))}
      </pre>
    );
  }

  function renderToken(
    t: Token,
    i: number,
    resolvable: Set<string>,
    onNavigate: (namespace: string, key: string) => void,
  ) {
    if (t.kind === "text") return t.text;
    if (resolvable.has(`${t.namespace}\x00${t.key}`)) {
      return (
        <button
          key={i}
          className="wikilink"
          onClick={() => onNavigate(t.namespace, t.key)}
        >
          {t.raw}
        </button>
      );
    }
    return (
      <span key={i} className="wikilink wikilink--dangling">
        {t.raw}
      </span>
    );
  }
  ```
- [ ] In `ui/src/styles.css`, add the wikilink atoms right after the `.reader__content` drill override block (after the closing brace of `.reader--drill .reader__content`, before the `/* related: ... */` comment):
  ```css
  /* inline wikilinks in the body: green + navigable, or muted when dangling */
  .wikilink {
    font: inherit;
    color: var(--accent);
    font-weight: 600;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .wikilink:hover {
    color: var(--accent-ink);
    text-decoration: underline;
  }
  .wikilink--dangling {
    color: var(--ink-4);
    font-weight: 500;
    cursor: default;
  }
  .wikilink--dangling:hover {
    text-decoration: none;
  }
  ```
- [ ] Verify: `npm run build:ui` — expect a clean build.
- [ ] Commit:
  ```
  git add ui/src/Reader.tsx ui/src/styles.css
  git commit -m "feat(ui): render inline + dangling wikilinks in the reader body

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: 401 preserves the address through re-auth

Carry the current address through the sign-in bounce so the user lands back on the same memory.

**Files:**
- `ui/src/auth.ts` — Read only (confirm contract)
- `ui/src/api.ts` — Modify
- `ui/src/SignIn.tsx` — Modify

- [ ] Confirm the auth contract by re-reading `ui/src/auth.ts`: `authorizeResume()` returns `/api/auth/oauth2/authorize<search>` **only** when the query string has `client_id` (the OAuth-bounce case), else `null`. So a plain expired-session visit has `resume === null`, which is exactly the case where our new `next` must win. No edit to `auth.ts`.
- [ ] In `ui/src/api.ts`, change the 401 branch of `get<T>` to preserve the address. Old:
  ```ts
    // The API 401s when the session is absent/expired; bounce to sign-in (private surface).
    if (res.status === 401) {
      location.href = "/sign-in";
      throw new Error("unauthenticated");
    }
  ```
  New:
  ```ts
    // The API 401s when the session is absent/expired; bounce to sign-in (private surface),
    // carrying the current address so re-auth returns the user to the same memory.
    if (res.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = "/sign-in?next=" + next;
      throw new Error("unauthenticated");
    }
  ```
- [ ] In `ui/src/SignIn.tsx`, make the not-signed-in `callbackURL` honour `next`. Old:
  ```tsx
    // Not signed in. callbackURL resumes the OAuth flow if we're mid-authorize, else
    // lands on the app home. Dedicated centered card (not the generic Shell) so the entry
    // screen gets the Foundations treatment.
    const callbackURL = resume ?? "/";
  ```
  New:
  ```tsx
    // Not signed in. callbackURL resumes the OAuth flow if we're mid-authorize, else returns to the
    // address that 401'd (api.ts sets ?next=), else the app home. Dedicated centered card (not the
    // generic Shell) so the entry screen gets the Foundations treatment.
    const next = new URLSearchParams(location.search).get("next");
    const callbackURL = resume ?? next ?? "/";
  ```
- [ ] Verify: `npm run build:ui` — expect a clean build.
- [ ] Commit:
  ```
  git add ui/src/api.ts ui/src/SignIn.tsx
  git commit -m "feat(ui): 401 re-auth returns to the same memory address

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: Distinguish loading vs error in the view-model (`useBrowser.ts`)

Today `null` means both "loading" and "failed" for `flat` / `results` / `detail`, so a failed fetch shows an infinite skeleton (P1 review flag). Add three error booleans to `BrowserView` and set them in `.catch` on the three fetches.

**Files:**
- `ui/src/useBrowser.ts` — Modify

- [ ] Add the three flags to the `BrowserView` interface. Old:
  ```ts
    flat: Row[] | null; // Recent/Hubs/Orphans list; null while loading
    results: Row[] | null; // search results; non-null only while a query is active
    detail: ReadResult | null;
    selected: { namespace: string; key: string } | null;
  ```
  New:
  ```ts
    flat: Row[] | null; // Recent/Hubs/Orphans list; null while loading
    flatError: boolean; // the flat-lens fetch failed (distinguishes failure from the loading null)
    results: Row[] | null; // search results; non-null only while a query is active
    resultsError: boolean; // the search fetch failed
    detail: ReadResult | null;
    detailError: boolean; // the read fetch failed (distinguishes failure from the loading null)
    selected: { namespace: string; key: string } | null;
  ```
- [ ] Add the three state hooks next to the existing ones. Old:
  ```ts
    const [flat, setFlat] = useState<Row[] | null>(null);
    const [results, setResults] = useState<Row[] | null>(null);
  ```
  New:
  ```ts
    const [flat, setFlat] = useState<Row[] | null>(null);
    const [flatError, setFlatError] = useState(false);
    const [results, setResults] = useState<Row[] | null>(null);
    const [resultsError, setResultsError] = useState(false);
  ```
- [ ] Add the `detailError` state next to `detail`. Old:
  ```ts
    const [detail, setDetail] = useState<ReadResult | null>(null);
  ```
  New:
  ```ts
    const [detail, setDetail] = useState<ReadResult | null>(null);
    const [detailError, setDetailError] = useState(false);
  ```
- [ ] Wrap the flat-lens effect with a reset + `.catch`. Old:
  ```ts
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
  ```
  New:
  ```ts
      let live = true;
      setFlat(null);
      setFlatError(false);
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
      load
        .then(({ rows, total }) => {
          if (!live) return;
          setFlat(rows);
          setTotals((t) => ({ ...t, memories: total }));
        })
        .catch(() => {
          if (live) setFlatError(true);
        });
      return () => {
        live = false;
      };
  ```
- [ ] Wrap the search effect. Old:
  ```ts
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
  ```
  New:
  ```ts
      let live = true;
      setResultsError(false);
      recall(q)
        .then((ms) => {
          if (!live) return;
          setResults(
            ms.map((m) => ({
              namespace: m.namespace,
              key: m.key,
              type: m.type,
              snippet: firstLine(m.content).slice(0, 140),
            })),
          );
        })
        .catch(() => {
          if (live) setResultsError(true);
        });
      return () => {
        live = false;
      };
  ```
- [ ] Wrap the detail effect. Old:
  ```ts
      let live = true;
      readMemory(selected.namespace, selected.key).then((d) => {
        if (live) setDetail(d);
      });
      return () => {
        live = false;
      };
  ```
  New:
  ```ts
      let live = true;
      setDetail(null);
      setDetailError(false);
      readMemory(selected.namespace, selected.key)
        .then((d) => {
          if (live) setDetail(d);
        })
        .catch(() => {
          if (live) setDetailError(true);
        });
      return () => {
        live = false;
      };
  ```
  > Note: `setDetail(null)` is added so a *successful* prior read doesn't linger while the next address loads — this is what lets Reader distinguish "loading the newly-selected memory" from "showing the previous one". The `if (!selected)` branch above already calls `setDetail(null)`; leave it as-is but add `setDetailError(false)` there too (next step).
- [ ] In the same detail effect, reset the error flag when nothing is selected. Old:
  ```ts
      if (!selected) {
        setDetail(null);
        return;
      }
  ```
  New:
  ```ts
      if (!selected) {
        setDetail(null);
        setDetailError(false);
        return;
      }
  ```
- [ ] Add the three flags to the returned view-model object. Old:
  ```ts
      tree,
      expanded,
      leaves,
      flat,
      results,
      detail,
      selected,
  ```
  New:
  ```ts
      tree,
      expanded,
      leaves,
      flat,
      flatError,
      results,
      resultsError,
      detail,
      detailError,
      selected,
  ```
- [ ] Verify: `npm run build:ui` — expect a clean build.
- [ ] Commit:
  ```
  git add ui/src/useBrowser.ts
  git commit -m "feat(ui): surface fetch errors in the browser view-model

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: Render the error + loading states in `TreePane.tsx`, `Reader.tsx`, `Browser.tsx`

Wire the new flags through. TreePane shows "Couldn't load — retry?" copy instead of the skeleton on error; Reader shows an error line on `detailError` and a "Loading…" line while a selected memory is still fetching; Browser passes the props through.

**Files:**
- `ui/src/TreePane.tsx` — Modify
- `ui/src/Reader.tsx` — Modify
- `ui/src/Browser.tsx` — Modify
- `ui/src/styles.css` — Modify

- [ ] In `ui/src/TreePane.tsx`, add `flatError` and `resultsError` to the component props. Old:
  ```tsx
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
  ```
  New:
  ```tsx
    lens: Lens;
    query: string;
    tree: TreeNode[] | null;
    expanded: Set<string>;
    leaves: Record<string, Row[]>;
    flat: Row[] | null;
    flatError: boolean;
    results: Row[] | null;
    resultsError: boolean;
    selected: Selected;
    onToggle: (node: TreeNode) => void;
    onOpen: (namespace: string, key: string) => void;
    onExpandAll: () => void;
  }) {
  ```
- [ ] Pass them into `renderBody`. Old:
  ```tsx
      <div className="tree__body">
        {renderBody({ lens, query, tree, expanded, leaves, flat, results, selected, onToggle, onOpen })}
      </div>
  ```
  New:
  ```tsx
      <div className="tree__body">
        {renderBody({ lens, query, tree, expanded, leaves, flat, flatError, results, resultsError, selected, onToggle, onOpen })}
      </div>
  ```
- [ ] Add `flatError` / `resultsError` to the `renderBody` parameter type. Old:
  ```tsx
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
  ```
  New:
  ```tsx
  function renderBody(p: {
    lens: Lens;
    query: string;
    tree: TreeNode[] | null;
    expanded: Set<string>;
    leaves: Record<string, Row[]>;
    flat: Row[] | null;
    flatError: boolean;
    results: Row[] | null;
    resultsError: boolean;
    selected: Selected;
    onToggle: (node: TreeNode) => void;
    onOpen: (namespace: string, key: string) => void;
  }) {
  ```
- [ ] In `renderBody`, show the error copy before the skeleton in the search branch. Old:
  ```tsx
    // Search results take precedence whenever a query is active.
    if (p.query.trim()) {
      if (!p.results) return <div className="tree__skeleton">…</div>;
  ```
  New:
  ```tsx
    // Search results take precedence whenever a query is active.
    if (p.query.trim()) {
      if (p.resultsError)
        return <p className="tree__error">Couldn&apos;t load results — retry?</p>;
      if (!p.results) return <div className="tree__skeleton">…</div>;
  ```
- [ ] In the flat-lens branch, show the error copy before the skeleton. Old:
  ```tsx
    // A flat lens (Recent / Hubs / Orphans).
    if (!p.flat) return <div className="tree__skeleton">…</div>;
  ```
  New:
  ```tsx
    // A flat lens (Recent / Hubs / Orphans).
    if (p.flatError)
      return <p className="tree__error">Couldn&apos;t load — retry?</p>;
    if (!p.flat) return <div className="tree__skeleton">…</div>;
  ```
- [ ] In `ui/src/Reader.tsx`, add `detailError` and a `selected` flag to the props so the empty section can branch between loading / error / empty. Old:
  ```tsx
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
  ```
  New:
  ```tsx
  export function Reader({
    detail,
    detailError,
    selected,
    mode,
    empty,
    onNavigate,
    onDrill,
    onShowTree,
  }: {
    detail: ReadResult | null;
    detailError: boolean;
    selected: boolean;
    mode: Mode;
    empty: string;
    onNavigate: (namespace: string, key: string) => void;
    onDrill: () => void;
    onShowTree: () => void;
  }) {
    if (!detail) {
      // Three empty-ish states: a failed read, a memory still loading, or nothing selected.
      const message = detailError
        ? "Couldn't load this memory — retry?"
        : selected
          ? "Loading…"
          : empty;
      return (
        <section className="reader reader--empty">
          <p>{message}</p>
        </section>
      );
    }
  ```
- [ ] In `ui/src/Browser.tsx`, pass the new props through. Old:
  ```tsx
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
  ```
  New:
  ```tsx
          <TreePane
            lens={vm.lens}
            query={vm.query}
            tree={vm.tree}
            expanded={vm.expanded}
            leaves={vm.leaves}
            flat={vm.flat}
            flatError={vm.flatError}
            results={vm.results}
            resultsError={vm.resultsError}
            selected={vm.selected}
            onToggle={vm.toggleFolder}
            onOpen={vm.open}
            onExpandAll={vm.expandAll}
          />
        )}
        <Reader
          detail={vm.detail}
          detailError={vm.detailError}
          selected={!!vm.selected}
          mode={vm.mode}
          empty={emptyReader}
          onNavigate={vm.open}
          onDrill={vm.drill}
          onShowTree={vm.showTree}
        />
  ```
- [ ] In `ui/src/styles.css`, add the tree error copy style right after the `.tree__skeleton` block:
  ```css
  .tree__error {
    padding: var(--s-5) var(--s-4);
    font-size: 13px;
    color: var(--ink-3);
    line-height: 1.6;
  }
  ```
- [ ] Verify: `npm run build:ui` — expect a clean build.
- [ ] Commit:
  ```
  git add ui/src/TreePane.tsx ui/src/Reader.tsx ui/src/Browser.tsx ui/src/styles.css
  git commit -m "feat(ui): distinguish loading vs error in tree and reader

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6: Verify per-lens empty messages and full-suite green

The per-lens empty messages already exist (`emptyLensMessage` in TreePane: orphans / hubs / fallback; the search-empty "No matches" line; the tree-empty "Agents haven't written anything here yet"). Confirm they cover the matrix and that nothing regressed. No new code expected unless a genuine gap is found.

**Files:**
- `ui/src/TreePane.tsx` — Read only (verify)

- [ ] Re-read the `emptyLensMessage` and `renderBody` empty branches in `ui/src/TreePane.tsx`. Confirm coverage: orphans empty ("No orphans — everything here is linked."), hubs empty ("No hubs yet — nothing is linked to."), recent/all empty ("Nothing here yet."), search empty ("No matches. Try a broader term."), namespaces empty ("Agents haven't written anything here yet."). These satisfy the spec's per-lens / empty-store rows. **If and only if** the `all` lens reads oddly with the generic "Nothing here yet." (it shares the fallback), leave it — "dumbest thing that works"; do not add a branch for a state that only occurs in a fully-empty store, where the namespaces tree already shows the orient copy.
- [ ] Run the full test suite: `npx vitest run` — expect all suites green, including the existing `tests/wikilinks.test.ts`, `tests/namespace-tree.test.ts`, and the new `tests/wikilink-text.test.ts`. Read the summary line and confirm 0 failed.
- [ ] Run the full typecheck + build: `npm run build` — expect `vite build ui` then `tsc` to complete with no errors. (This is the only step that runs `tsc`; it typechecks the server, not the un-typed UI bundle.)
- [ ] No commit if no code changed. If a genuine gap was filled, commit:
  ```
  git add ui/src/TreePane.tsx
  git commit -m "fix(ui): fill <gap> empty-state message

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Self-review notes

**Spec coverage (P2 items #4 and #6, plus the 401 flag from "States & interactions"):**
- #4 inline wikilinks — Task 1 (tokenizer) + Task 2 (resolvable green `<button className="wikilink">` calling `onNavigate`). Title stays plain (untouched `firstLine`).
- #4 dangling wikilinks — Task 2: anything whose `(namespace,key)` is not in `detail.children` renders as a muted, non-interactive `<span className="wikilink wikilink--dangling">`. Relies on the spec/store fact that dangling targets are omitted from `children` server-side. **Confirmed** against `src/core/store.ts` (`ReadResult.children: Neighbour[]`, populated by `outboundNeighbours`).
- #6 loading vs error — Task 4 adds `flatError`/`resultsError`/`detailError`; Task 5 renders "Couldn't load — retry?" (tree) and the loading/error/empty branch (reader). The infinite-skeleton-on-failure bug from the P1 review is fixed.
- #6 empty matrix — Task 6 verifies the existing per-lens empties; no rebuild (spec rule "do not rebuild what exists").
- "Session expired (401): route to re-auth without losing the current address" — Task 3 (`?next=` in api.ts + `callbackURL = resume ?? next ?? "/"` in SignIn.tsx). `auth.ts` left unchanged; `resume` still wins for the OAuth-bounce case, `next` for the plain expiry case — verified against the `client_id` gate in `authorizeResume()`.

**Placeholder scan:** no "TBD" / "add error handling" / "similar to Task N". Every code block is concrete, lifted from the actual current file contents read during planning.

**Type consistency:**
- `Token` is exported from `wikilinkText.ts` and imported type-only into both the test (`.js` specifier, erased at runtime) and `Reader.tsx`.
- `BrowserView` gains `flatError`, `resultsError`, `detailError: boolean`; all three are returned from `useBrowser` and threaded through `Browser.tsx` → `TreePane`/`Reader`. The `Reader` prop set gains `detailError: boolean` and `selected: boolean` (Browser passes `!!vm.selected`).
- The resolvable-set key uses the same `\x00` separator the server uses for its dedup signature (`${namespace}\x00${key}`), avoiding collisions where a namespace ends with a character that could merge with a key.
- No `@types/react` reliance beyond what the existing components already use; no `tsc -p ui` is run (per Conventions). UI verified with `npm run build:ui`; server + full typecheck with `npm run build`; logic with `npx vitest run`.

**Out of scope (correctly deferred, per spec):** ⌘K palette, Tags lens / list-by-tag backend, prune + guardrail, keyboard nav, the "All" lens, the chevron-glyph fix, and the login redesign — those are separate P2 plans. This plan adds **no server change**.
