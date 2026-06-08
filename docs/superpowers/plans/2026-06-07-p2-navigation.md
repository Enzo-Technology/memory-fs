# Navigation (⌘K palette + keyboard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two P2 *Navigation* surfaces from the tree-IA spec — (1) a ⌘K command palette (the single allowed floating/elevated surface) for full-text power-search that opens a memory with the keyboard, and (2) full keyboard navigation over the existing tree / flat lists / search results (↑↓ move a visible cursor, →← expand/collapse folders, ↵ open-then-drill, Esc step back). The existing top-bar inline search stays exactly as-is; ⌘K is additive.

**Architecture:** The browser is a single deep hook (`ui/src/useBrowser.ts`) feeding thin presentational panes composed in `ui/src/Browser.tsx`. The palette lands as a brand-new, fully self-contained component (`ui/src/CommandPalette.tsx`) that holds its own query/recall/highlight state and is mounted by `Browser.tsx` behind a `paletteOpen` flag in the view-model. Keyboard nav over the tree is split into a **pure** helper (`ui/src/visibleRows.ts`, TDD'd in isolation like `namespaceTree.ts`/`sortRows.ts`) that flattens the currently-visible navigable rows, plus new `cursor` state + actions in `useBrowser`, plus a global `keydown` handler in `Browser.tsx`, plus a `--cursor` highlight class in `ui/src/styles.css`.

**Tech Stack:** React 19 + Vite (`@vitejs/plugin-react`), bundled by `vite build ui`. Pure logic is unit-tested with Vitest. No router library (path switch in `App.tsx`). `recall` / `read` / `browse` go through `ui/src/api.ts`; no backend change.

---

## Conventions & gotchas

- **No UI typecheck.** `@types/react` is NOT installed (verified) and the UI is built by Vite/esbuild-transform, which strips types without checking them. **Do NOT run `tsc -p ui` or `tsc` against the UI.** Verify the UI with `npm run build:ui` (= `vite build ui`). Verify the server with `npm run build`. Verify pure logic with `npx vitest run`.
- **Pure tests live under `tests/`** and import UI source with a **`.js` specifier** (TypeScript path, JS extension) — e.g. `import { flattenVisible } from "../ui/src/visibleRows.js";`. Type-only imports are erased at build, so importing a `type` from `useBrowser` in the util is fine but **avoid runtime imports from React components in the pure util** (keep `visibleRows.ts` dependency-free except a type-only import of `TreeNode`/`Row`).
- **Shared working tree.** A concurrent agent may `git checkout` in this same tree. **Do NOT run `git checkout`, `git switch`, or `git branch`.** Commit to the CURRENT branch. Stage with **targeted `git add <files>`** — never `git add -A` / `git add .`.
- **Conventional commits**, scoped `ui` for presentational/wiring, `test` may piggyback. End every commit body with the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **`recall` returns `Memory[]`** (full memories — see `ui/src/api.ts`), unlike the flat-lens calls which return `BrowseResult`. The palette must map `Memory` → row using `firstLine(m.content)` for the snippet, exactly as the existing search effect in `useBrowser` does.
- **`live`-guard pattern** for async effects (cancel stale responses) is used throughout `useBrowser`; mirror it in the palette's recall effect.
- **Reserved elevation:** per the grid spec, the ⌘K overlay is the ONE surface allowed a shadow. Everything else is lines + whitespace. Do not add shadows to tree/list rows.
- **Address row markup** is duplicated (~10 lines) from `TreePane`'s `MemoryRow` into the palette result row on purpose — duplicating that markup is explicitly fine; do not over-abstract.
- `cursorActivate` for a leaf must mirror `Reader`'s open→drill: opening an already-selected memory drills it (matches the spec line "↵ open in pane, again to drill").

## File structure

```
ui/src/CommandPalette.tsx   NEW  self-contained ⌘K overlay (query + recall + highlight + keys)
ui/src/visibleRows.ts       NEW  pure: flattenVisible(tree, expanded, leaves) -> NavItem[]
tests/visible-rows.test.ts  NEW  TDD for the pure flattener
ui/src/useBrowser.ts        EDIT paletteOpen + open/closePalette; cursor + move/expand/collapse/activate; active nav list
ui/src/Browser.tsx          EDIT mount palette; global keydown (⌘K opens palette; arrows/↵/Esc drive cursor)
ui/src/TreePane.tsx         EDIT thread a cursor address through; apply --cursor class + scrollIntoView
ui/src/styles.css           EDIT .palette* overlay styles; .trow--cursor / .mrow--cursor highlight
```

Sequence: **palette first** (self-contained, lands and ships independently) → **pure `flattenVisible`** (TDD) → **cursor state in useBrowser** → **global key handling + visual cursor highlight**.

---

## Task 1 — CommandPalette component (self-contained ⌘K overlay)

A centered floating overlay with its own state. No `useBrowser` coupling beyond the three props.

- [ ] Create `ui/src/CommandPalette.tsx` with this exact content:

```tsx
// The ⌘K command palette: the ONE elevated/floating surface in the app (grid spec reserves
// shadow for it). Self-contained — owns its own query, a live-guarded recall, and a highlighted
// result index. ↑/↓ move the highlight, ↵ opens the highlight, Esc / backdrop-click close.
// Additive power-search: the top-bar inline search stays as-is. Styling: .palette*.
import { useEffect, useRef, useState } from "react";
import { recall } from "./api";
import { TYPE_COLOR } from "./memoryType";

// First non-empty line of content — the de-facto title/snippet (the store stores no title).
function firstLine(content: string): string {
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

interface Hit {
  namespace: string;
  key: string;
  type: keyof typeof TYPE_COLOR;
  snippet: string;
}

export function CommandPalette({
  open,
  onClose,
  onOpenMemory,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMemory: (namespace: string, key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus + reset every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  // Live-guarded recall: cancel stale responses so a slow earlier query can't overwrite a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setActive(0);
      return;
    }
    let live = true;
    recall(q).then((ms) => {
      if (!live) return;
      setHits(
        ms.map((m) => ({
          namespace: m.namespace,
          key: m.key,
          type: m.type,
          snippet: firstLine(m.content).slice(0, 140),
        })),
      );
      setActive(0);
    });
    return () => {
      live = false;
    };
  }, [query]);

  if (!open) return null;

  const choose = (h: Hit) => {
    onOpenMemory(h.namespace, h.key);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (hits.length === 0 ? 0 : Math.min(i + 1, hits.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) choose(h);
    }
  };

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Search memories…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="palette__results">
          {query.trim() && hits.length === 0 && (
            <p className="palette__empty">No matches.</p>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.namespace}/${h.key}`}
              className={i === active ? "prow prow--active" : "prow"}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(h)}
            >
              <div className="prow__head">
                <span className="addr">
                  <span className="addr__ns">{h.namespace}</span>
                  <span className="addr__sep">/</span>
                  <span className="addr__key">{h.key}</span>
                </span>
                <span className="tdot" style={{ background: TYPE_COLOR[h.type].fg }} />
              </div>
              <span className="prow__snippet">{h.snippet}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] Add palette styles to `ui/src/styles.css`. Append after the sign-in block (the file currently ends at the `.signin__google:hover` rule). Insert:

```css

/* ---------- ⌘K command palette (the one elevated surface) ---------- */
.palette__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(27, 26, 23, 0.28);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 50;
}
.palette {
  width: 100%;
  max-width: 560px;
  background: var(--surface);
  border: 1px solid var(--hairline-2);
  border-radius: var(--r-lg);
  box-shadow: 0 24px 64px rgba(27, 26, 23, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}
.palette__input {
  height: 52px;
  border: none;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
  padding: 0 var(--s-5);
  font: inherit;
  font-size: 16px;
  color: var(--ink);
}
.palette__input::placeholder {
  color: var(--ink-4);
}
.palette__input:focus {
  outline: none;
}
.palette__results {
  overflow-y: auto;
  padding: var(--s-2) 0;
}
.palette__empty {
  padding: var(--s-4) var(--s-5);
  font-size: 13px;
  color: var(--ink-3);
}
.prow {
  width: 100%;
  background: none;
  border: none;
  text-align: left;
  padding: 10px var(--s-5);
  display: grid;
  gap: var(--s-1);
}
.prow--active {
  background: var(--accent-soft);
}
.prow__head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.prow__head .tdot {
  margin-left: auto;
}
.prow__snippet {
  font-size: 13px;
  color: var(--ink-3);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] Verify the UI builds: `npm run build:ui`
  - Expected: `vite build` completes with `✓ built in …`, writing to `../dist/ui`, no errors. (The component isn't mounted yet — this only proves it compiles/bundles.)
- [ ] Commit:
  ```
  git add ui/src/CommandPalette.tsx ui/src/styles.css
  git commit -m "$(cat <<'EOF'
  feat(ui): add ⌘K command palette component

  Self-contained centered overlay (the one elevated surface): own query +
  live-guarded recall + highlighted index. ↑↓ move, ↵ opens, Esc/backdrop close.
  Not yet wired into the browser.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 2 — Wire the palette into the browser (paletteOpen + ⌘K listener)

Keep the top-bar inline search untouched. (Alternative considered: replace the top-bar search with the palette. Rejected — the inline search works and is part of shipped P1; ⌘K is an additive power-search surface, so we keep both.)

- [ ] In `ui/src/useBrowser.ts`, add `paletteOpen` to the `BrowserView` interface. Current actions block (ends at `showTree`):

```ts
  open: (namespace: string, key: string) => void;
  drill: () => void;
  showTree: () => void;
}
```

becomes:

```ts
  open: (namespace: string, key: string) => void;
  drill: () => void;
  showTree: () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}
```

- [ ] Add the state. After the existing `const [mode, setMode] = useState<Mode>("split");` line:

```ts
  const [mode, setMode] = useState<Mode>("split");
```

becomes:

```ts
  const [mode, setMode] = useState<Mode>("split");
  const [paletteOpen, setPaletteOpen] = useState(false);
```

- [ ] Add the three fields to the returned object. The current return tail:

```ts
    open,
    drill: useCallback(() => setMode("drill"), []),
    showTree: useCallback(() => setMode("split"), []),
  };
}
```

becomes:

```ts
    open,
    drill: useCallback(() => setMode("drill"), []),
    showTree: useCallback(() => setMode("split"), []),
    paletteOpen,
    openPalette: useCallback(() => setPaletteOpen(true), []),
    closePalette: useCallback(() => setPaletteOpen(false), []),
  };
}
```

- [ ] In `ui/src/Browser.tsx`, import the palette + React's `useEffect`. Current imports:

```tsx
import { useBrowser } from "./useBrowser";
import { TopBar } from "./TopBar";
import { LensRow } from "./LensRow";
import { TreePane } from "./TreePane";
import { Reader } from "./Reader";
```

becomes:

```tsx
import { useEffect } from "react";
import { useBrowser } from "./useBrowser";
import { TopBar } from "./TopBar";
import { LensRow } from "./LensRow";
import { TreePane } from "./TreePane";
import { Reader } from "./Reader";
import { CommandPalette } from "./CommandPalette";
```

- [ ] Install the ⌘K / Ctrl+K global listener and mount the palette. Current body (from `const vm = useBrowser();` to the closing `</div>`):

```tsx
  const vm = useBrowser();
  const drilled = vm.mode === "drill";
  const emptyReader =
    vm.totals.memories === 0
      ? "Agents haven't written anything here yet."
      : "Select a memory.";
  return (
    <div className={drilled ? "app app--drill" : "app"}>
      <TopBar query={vm.query} onQuery={vm.setQuery} email={email} onSignOut={onSignOut} />
```

becomes:

```tsx
  const vm = useBrowser();
  const drilled = vm.mode === "drill";
  const emptyReader =
    vm.totals.memories === 0
      ? "Agents haven't written anything here yet."
      : "Select a memory.";

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        vm.openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm.openPalette]);

  return (
    <div className={drilled ? "app app--drill" : "app"}>
      {vm.paletteOpen && (
        <CommandPalette
          open={vm.paletteOpen}
          onClose={vm.closePalette}
          onOpenMemory={vm.open}
        />
      )}
      <TopBar query={vm.query} onQuery={vm.setQuery} email={email} onSignOut={onSignOut} />
```

- [ ] Verify the UI builds: `npm run build:ui`
  - Expected: `✓ built in …`, no errors.
- [ ] Manual sanity (optional but recommended): `npm run dev` then in the browser press ⌘K — palette opens centered with focus in the input; typing shows results; ↑↓ move the highlight; ↵ opens the memory and closes; Esc / clicking the backdrop closes.
- [ ] Commit:
  ```
  git add ui/src/useBrowser.ts ui/src/Browser.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui): wire ⌘K palette into the browser

  paletteOpen + open/closePalette on the view-model; Browser mounts the palette
  and installs a global ⌘K/Ctrl+K keydown that opens it. Top-bar search kept as-is.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 3 — Pure `flattenVisible` util (TDD)

The ordered list of currently-visible navigable items for the Namespaces tree, so the cursor logic stays out of components. Depth-first: emit each folder; if expanded, recurse into children, then (if its leaves are loaded) emit its leaf items.

- [ ] **Write the failing test first.** Create `tests/visible-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { flattenVisible } from "../ui/src/visibleRows.js";
import type { TreeNode } from "../ui/src/namespaceTree.js";
import type { Row } from "../ui/src/useBrowser.js";

// Minimal builders so the tests read as IA, not plumbing.
function folder(namespace: string, count: number, children: TreeNode[] = []): TreeNode {
  const name = namespace.split(":").pop()!;
  return { name, namespace, count, total: count, children };
}
function row(namespace: string, key: string): Row {
  return { namespace, key, type: "note", snippet: "" };
}

describe("flattenVisible", () => {
  it("returns [] for an empty tree", () => {
    expect(flattenVisible([], new Set(), {})).toEqual([]);
  });

  it("yields just the folder when it is closed", () => {
    const tree = [folder("voice", 2)];
    expect(flattenVisible(tree, new Set(), { voice: [row("voice", "a")] })).toEqual([
      { kind: "folder", namespace: "voice" },
    ]);
  });

  it("yields children then own leaves when a folder is expanded", () => {
    const tree = [folder("voice", 1, [folder("voice:onboarding", 1)])];
    const expanded = new Set(["voice"]);
    const leaves = { voice: [row("voice", "tone")] };
    expect(flattenVisible(tree, expanded, leaves)).toEqual([
      { kind: "folder", namespace: "voice" },
      { kind: "folder", namespace: "voice:onboarding" },
      { kind: "leaf", namespace: "voice", key: "tone" },
    ]);
  });

  it("orders nested expansion depth-first: child folder's leaves before parent's leaves", () => {
    const tree = [folder("voice", 1, [folder("voice:onboarding", 1)])];
    const expanded = new Set(["voice", "voice:onboarding"]);
    const leaves = {
      voice: [row("voice", "tone")],
      "voice:onboarding": [row("voice:onboarding", "greeting")],
    };
    expect(flattenVisible(tree, expanded, leaves)).toEqual([
      { kind: "folder", namespace: "voice" },
      { kind: "folder", namespace: "voice:onboarding" },
      { kind: "leaf", namespace: "voice:onboarding", key: "greeting" },
      { kind: "leaf", namespace: "voice", key: "tone" },
    ]);
  });

  it("emits no leaf items when an expanded folder's leaves are not yet loaded", () => {
    const tree = [folder("voice", 2)];
    const expanded = new Set(["voice"]);
    expect(flattenVisible(tree, expanded, {})).toEqual([
      { kind: "folder", namespace: "voice" },
    ]);
  });
});
```

- [ ] Run it and confirm it FAILS (module does not exist yet): `npx vitest run tests/visible-rows.test.ts`
  - Expected: failure resolving `../ui/src/visibleRows.js` (cannot find module) — a red run. This proves the test is wired before any implementation.
- [ ] **Implement.** Create `ui/src/visibleRows.ts`:

```ts
// Pure: the ordered list of currently-visible navigable rows for the Namespaces tree, so the
// keyboard cursor in useBrowser indexes a flat list instead of re-walking the tree. Depth-first —
// emit each folder; if expanded, recurse into its child folders, then (only once its leaves have
// lazy-loaded) emit its own leaf rows. Mirrors FolderRow's render order in TreePane. The flat/search
// lenses don't need this (their nav list is just the rows) — handled in useBrowser.
import type { TreeNode } from "./namespaceTree";
import type { Row } from "./useBrowser";

export type NavItem =
  | { kind: "folder"; namespace: string }
  | { kind: "leaf"; namespace: string; key: string };

export function flattenVisible(
  tree: TreeNode[],
  expanded: Set<string>,
  leaves: Record<string, Row[]>,
): NavItem[] {
  const out: NavItem[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      out.push({ kind: "folder", namespace: node.namespace });
      if (!expanded.has(node.namespace)) continue;
      walk(node.children);
      if (node.count > 0 && node.namespace in leaves) {
        for (const r of leaves[node.namespace]!) {
          out.push({ kind: "leaf", namespace: r.namespace, key: r.key });
        }
      }
    }
  };
  walk(tree);
  return out;
}
```

- [ ] Run it and confirm it PASSES: `npx vitest run tests/visible-rows.test.ts`
  - Expected: `Test Files  1 passed`, `Tests  5 passed`.
- [ ] Commit:
  ```
  git add ui/src/visibleRows.ts tests/visible-rows.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ui): pure flattenVisible for tree keyboard nav

  Depth-first list of visible folders + loaded leaves, mirroring FolderRow's
  render order. Unit-tested in isolation (empty, closed, expanded, nested,
  unloaded-leaves). Drives the keyboard cursor in the next pass.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 4 — Cursor state + actions in useBrowser

A single `cursor` index over the active nav list (tree → `flattenVisible`; flat/search → the rows). Reset on lens/query change. Actions: `moveCursor`, `cursorExpand`/`cursorCollapse`, `cursorActivate`. Expose the resolved cursor *address* (for highlighting) too.

- [ ] In `ui/src/useBrowser.ts`, add imports. Current:

```ts
import { buildTree, type TreeNode } from "./namespaceTree";
import { addressToPath, parseAddress } from "./route";
import { sortByAddress } from "./sortRows";
```

becomes:

```ts
import { buildTree, type TreeNode } from "./namespaceTree";
import { addressToPath, parseAddress } from "./route";
import { sortByAddress } from "./sortRows";
import { flattenVisible, type NavItem } from "./visibleRows";
```

- [ ] Extend the `BrowserView` interface. After the palette fields added in Task 2:

```ts
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}
```

becomes:

```ts
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  cursor: number;
  cursorAddress: { namespace: string; key: string } | null; // the cursored row, if it is a leaf/memory
  moveCursor: (delta: number) => void;
  cursorExpand: () => void;
  cursorCollapse: () => void;
  cursorActivate: () => void;
}
```

- [ ] Add cursor state next to the palette state:

```ts
  const [paletteOpen, setPaletteOpen] = useState(false);
```

becomes:

```ts
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
```

- [ ] Build the active nav list with `useMemo`, after the `tree` memo (the `tree` memo ends at the line `);` following `[namespaceItems],`). Insert:

```ts
  const tree = useMemo(
    () => (namespaceItems ? buildTree(namespaceItems) : null),
    [namespaceItems],
  );
```

becomes:

```ts
  const tree = useMemo(
    () => (namespaceItems ? buildTree(namespaceItems) : null),
    [namespaceItems],
  );

  // The flat, ordered list the keyboard cursor indexes: tree-lens -> flattenVisible; otherwise the
  // active rows (search results take precedence over the flat lens, matching TreePane.renderBody).
  const navItems = useMemo<NavItem[]>(() => {
    const rowsToNav = (rows: Row[]): NavItem[] =>
      rows.map((r) => ({ kind: "leaf", namespace: r.namespace, key: r.key }));
    if (query.trim()) return rowsToNav(results ?? []);
    if (lens === "namespaces") return tree ? flattenVisible(tree, expanded, leaves) : [];
    return rowsToNav(flat ?? []);
  }, [query, lens, tree, expanded, leaves, results, flat]);
```

- [ ] Reset the cursor whenever the lens or query changes (a fresh `useEffect`). Insert it right after the `navItems` memo above:

```ts
  // Reset the cursor when the active list's identity changes (new lens / new search).
  useEffect(() => {
    setCursor(0);
  }, [lens, query]);
```

- [ ] Derive the cursor's address (a leaf → its address; a folder → null). After the reset effect:

```ts
  const cursorAddress = useMemo(() => {
    const item = navItems[cursor];
    return item && item.kind === "leaf"
      ? { namespace: item.namespace, key: item.key }
      : null;
  }, [navItems, cursor]);
```

- [ ] Add the cursor actions. Place them just before the existing `const open = useCallback(...)` definition:

```ts
  const open = useCallback((namespace: string, key: string) => {
```

becomes (prepend the four actions, keep `open` after):

```ts
  const moveCursor = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const max = navItems.length - 1;
        if (max < 0) return 0;
        return Math.min(Math.max(c + delta, 0), max);
      });
    },
    [navItems.length],
  );

  const cursorExpand = useCallback(() => {
    const item = navItems[cursor];
    if (!item || item.kind !== "folder" || !tree) return;
    if (expanded.has(item.namespace)) return; // already open — let the next ↓ move into it
    const node = findNode(tree, item.namespace);
    if (node) toggleFolder(node);
  }, [navItems, cursor, tree, expanded]);

  const cursorCollapse = useCallback(() => {
    const item = navItems[cursor];
    if (!item || item.kind !== "folder" || !tree) return;
    if (!expanded.has(item.namespace)) return; // already closed
    const node = findNode(tree, item.namespace);
    if (node) toggleFolder(node);
  }, [navItems, cursor, tree, expanded]);

  const cursorActivate = useCallback(() => {
    const item = navItems[cursor];
    if (!item) return;
    if (item.kind === "folder") {
      if (!tree) return;
      const node = findNode(tree, item.namespace);
      if (node) toggleFolder(node);
      return;
    }
    // A leaf: open it; if it is already the selected memory, drill (mirrors Reader's focus toggle).
    const alreadySelected =
      !!selected && selected.namespace === item.namespace && selected.key === item.key;
    if (alreadySelected) setMode("drill");
    else open(item.namespace, item.key);
  }, [navItems, cursor, tree, expanded, selected]);

  const open = useCallback((namespace: string, key: string) => {
```

  > `toggleFolder` and `open` are referenced above before their `const` declarations; this is fine because the callbacks only run at event time (after all `const`s are initialized), not during render. Keep them out of the dependency arrays to avoid a declaration-order TDZ in the deps list — the closures capture the latest values through React's render anyway since `navItems`/`tree`/`expanded`/`selected` are the real inputs. (Mirrors how `expandAll` already calls `ensureLeaf`.)

- [ ] Add the `findNode` helper near the other module-level pure helpers (after `toRows`, before `export function useBrowser`):

```ts
// Locate a TreeNode by its full namespace (depth-first). Used by the keyboard cursor to turn a
// flattened NavItem back into the node toggleFolder expects.
function findNode(nodes: TreeNode[], namespace: string): TreeNode | null {
  for (const n of nodes) {
    if (n.namespace === namespace) return n;
    const hit = findNode(n.children, namespace);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] Expose the new fields in the return object. The palette tail from Task 2:

```ts
    paletteOpen,
    openPalette: useCallback(() => setPaletteOpen(true), []),
    closePalette: useCallback(() => setPaletteOpen(false), []),
  };
}
```

becomes:

```ts
    paletteOpen,
    openPalette: useCallback(() => setPaletteOpen(true), []),
    closePalette: useCallback(() => setPaletteOpen(false), []),
    cursor,
    cursorAddress,
    moveCursor,
    cursorExpand,
    cursorCollapse,
    cursorActivate,
  };
}
```

- [ ] Verify the UI builds: `npm run build:ui`
  - Expected: `✓ built in …`, no errors. (Nothing consumes the cursor yet — this proves the hook compiles.)
- [ ] Verify nothing regressed: `npx vitest run`
  - Expected: all test files pass (including `visible-rows`, `namespace-tree`, `sort-rows`, `route`).
- [ ] Commit:
  ```
  git add ui/src/useBrowser.ts
  git commit -m "$(cat <<'EOF'
  feat(ui): cursor state + actions in useBrowser

  A single cursor index over the active nav list (flattenVisible for the tree,
  rows for flat/search), reset on lens/query change. moveCursor clamps;
  cursorExpand/Collapse toggle a folder; cursorActivate toggles a folder or
  opens a leaf (drills if already selected). cursorAddress exposes the highlight.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 5 — Global key handling + visual cursor highlight

Wire the cursor to the keyboard in `Browser.tsx` (only when the palette is closed and focus is not in an input/textarea), and render the highlight + scroll-into-view in `TreePane.tsx` / `styles.css`.

- [ ] In `ui/src/Browser.tsx`, extend the keydown effect to also drive the cursor. The effect from Task 2:

```tsx
  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        vm.openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm.openPalette]);
```

becomes:

```tsx
  // Global keyboard: ⌘K opens the palette; arrows/↵/Esc drive the tree/list cursor. Skipped while
  // the palette is open (it owns its own keys) or while typing in a field (the top-bar search).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        vm.openPalette();
        return;
      }
      if (vm.paletteOpen) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vm.moveCursor(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          vm.moveCursor(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          vm.cursorExpand();
          break;
        case "ArrowLeft":
          e.preventDefault();
          vm.cursorCollapse();
          break;
        case "Enter":
          e.preventDefault();
          vm.cursorActivate();
          break;
        case "Escape":
          e.preventDefault();
          if (drilled) vm.showTree();
          else if (vm.query) vm.setQuery("");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    vm.openPalette,
    vm.paletteOpen,
    vm.moveCursor,
    vm.cursorExpand,
    vm.cursorCollapse,
    vm.cursorActivate,
    vm.showTree,
    vm.setQuery,
    vm.query,
    drilled,
  ]);
```

- [ ] Pass the cursor address into `TreePane`. Current `TreePane` usage in `Browser.tsx`:

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
```

becomes (add `cursorAddress`):

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
            cursorAddress={vm.cursorAddress}
            onToggle={vm.toggleFolder}
            onOpen={vm.open}
            onExpandAll={vm.expandAll}
          />
```

- [ ] In `ui/src/TreePane.tsx`, thread `cursorAddress` down to the rows and apply `--cursor` + scrollIntoView. First, the imports — add React hooks:

```tsx
import type { Lens } from "./api";
```

becomes:

```tsx
import { useEffect, useRef } from "react";
import type { Lens } from "./api";
```

- [ ] Add `cursorAddress` to the `TreePane` props type and forward it. The props destructure + type:

```tsx
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
```

becomes:

```tsx
export function TreePane({
  lens,
  query,
  tree,
  expanded,
  leaves,
  flat,
  results,
  selected,
  cursorAddress,
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
  cursorAddress: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
  onExpandAll: () => void;
}) {
```

- [ ] Forward `cursorAddress` into `renderBody`. The call:

```tsx
        {renderBody({ lens, query, tree, expanded, leaves, flat, results, selected, onToggle, onOpen })}
```

becomes:

```tsx
        {renderBody({ lens, query, tree, expanded, leaves, flat, results, selected, cursorAddress, onToggle, onOpen })}
```

- [ ] Add `cursorAddress` to `renderBody`'s param type and pass it to every `MemoryRow`/`FolderRow`. The `renderBody` signature:

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

becomes:

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
  cursorAddress: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
}) {
```

- [ ] In `renderBody`, pass `cursorAddress` to the search-results rows. The results map:

```tsx
    return p.results.map((r) => (
      <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
    ));
```

becomes:

```tsx
    return p.results.map((r) => (
      <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} cursor={p.cursorAddress} onOpen={p.onOpen} />
    ));
```

- [ ] Pass `cursorAddress` to the tree's top-level `FolderRow`s. The tree map:

```tsx
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
```

becomes:

```tsx
    return p.tree.map((n) => (
      <FolderRow
        key={n.namespace}
        node={n}
        depth={0}
        expanded={p.expanded}
        leaves={p.leaves}
        selected={p.selected}
        cursor={p.cursorAddress}
        onToggle={p.onToggle}
        onOpen={p.onOpen}
      />
    ));
```

- [ ] Pass `cursorAddress` to the flat-list `MemoryRow`s. The flat map (end of `renderBody`):

```tsx
  return p.flat.map((r) => (
    <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
  ));
```

becomes:

```tsx
  return p.flat.map((r) => (
    <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} cursor={p.cursorAddress} onOpen={p.onOpen} />
  ));
```

- [ ] Thread `cursor` through `FolderRow` (it has a folder cursor of its own + forwards to its `LeafRow`s and child `FolderRow`s). `FolderRow`'s destructure + type:

```tsx
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
```

becomes:

```tsx
function FolderRow({
  node,
  depth,
  expanded,
  leaves,
  selected,
  cursor,
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  leaves: Record<string, Row[]>;
  selected: Selected;
  cursor: Selected;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
}) {
  const isOpen = expanded.has(node.namespace);
  const expandable = node.children.length > 0 || node.count > 0;
  const indent = { paddingLeft: 8 + depth * 20 };
  const childIndent = { paddingLeft: 8 + (depth + 1) * 20 };
  // The folder cursor highlight: a folder is cursored when cursorAddress is null AND this folder's
  // namespace matches — but cursorAddress carries only leaf addresses, so folders use a ref+effect
  // keyed on a data attribute instead. Simpler: compare by namespace via the dedicated prop below.
  const cursored = !!cursor && cursor.namespace === node.namespace && cursor.key === "";
  const ref = useScrollIntoView(cursored);
  return (
    <>
      <button
        ref={ref}
        className={cursored ? "trow trow--folder trow--cursor" : "trow trow--folder"}
        style={indent}
        onClick={() => onToggle(node)}
      >
```

  > **Folder-cursor representation.** `cursorAddress` only resolves to leaf addresses (folders give `null`), so a folder can't be highlighted by address alone. To keep the change small, encode a folder cursor as an address with an **empty key**: in `useBrowser`, change `cursorAddress` to also return folders. Apply the amendment in the next step before building.

- [ ] **Amend `useBrowser.cursorAddress`** (from Task 4) so folders are representable with an empty key. Current:

```ts
  const cursorAddress = useMemo(() => {
    const item = navItems[cursor];
    return item && item.kind === "leaf"
      ? { namespace: item.namespace, key: item.key }
      : null;
  }, [navItems, cursor]);
```

becomes:

```ts
  // The cursored row as an address: a leaf -> its (namespace,key); a folder -> (namespace,"") so
  // TreePane can highlight folders too (key "" never collides with a real memory key).
  const cursorAddress = useMemo(() => {
    const item = navItems[cursor];
    if (!item) return null;
    return item.kind === "leaf"
      ? { namespace: item.namespace, key: item.key }
      : { namespace: item.namespace, key: "" };
  }, [navItems, cursor]);
```

  > Note: `selected` never has an empty key (it comes from real opens), so the leaf/folder `--active` vs `--cursor` styles never clash.

- [ ] Add a small `useScrollIntoView` hook at the bottom of `TreePane.tsx` (after `MemoryRow`):

```tsx
// Scroll the cursored row into view when it becomes the cursor. `block: "nearest"` avoids
// yanking the whole pane when the row is already visible.
function useScrollIntoView(active: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return ref;
}
```

- [ ] Forward `cursor` into `FolderRow`'s recursive children and its `LeafRow`s. The body of `FolderRow` (child folders + leaves):

```tsx
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
```

becomes:

```tsx
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
              cursor={cursor}
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
                  cursor={cursor}
                  onOpen={onOpen}
                />
              ))
```

- [ ] Highlight + scroll the `LeafRow`. Its destructure + type + body:

```tsx
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
```

becomes:

```tsx
function LeafRow({
  row,
  indent,
  selected,
  cursor,
  onOpen,
}: {
  row: Row;
  indent: { paddingLeft: number };
  selected: Selected;
  cursor: Selected;
  onOpen: (namespace: string, key: string) => void;
}) {
  const active = !!selected && selected.namespace === row.namespace && selected.key === row.key;
  const cursored = !!cursor && cursor.namespace === row.namespace && cursor.key === row.key;
  const ref = useScrollIntoView(cursored);
  const cls = ["trow", "trow--leaf", active && "trow--active", cursored && "trow--cursor"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      className={cls}
      style={indent}
      onClick={() => onOpen(row.namespace, row.key)}
    >
```

- [ ] Highlight + scroll the `MemoryRow` (flat/search). Its destructure + type + body:

```tsx
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
```

becomes:

```tsx
function MemoryRow({
  row,
  selected,
  cursor,
  onOpen,
}: {
  row: Row;
  selected: Selected;
  cursor: Selected;
  onOpen: (namespace: string, key: string) => void;
}) {
  const active = !!selected && selected.namespace === row.namespace && selected.key === row.key;
  const cursored = !!cursor && cursor.namespace === row.namespace && cursor.key === row.key;
  const ref = useScrollIntoView(cursored);
  const cls = ["mrow", active && "mrow--active", cursored && "mrow--cursor"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      className={cls}
      onClick={() => onOpen(row.namespace, row.key)}
    >
```

- [ ] Add the cursor highlight CSS. In `ui/src/styles.css`, after the `.trow--active` rule (currently `.trow--active { background: var(--accent-soft); }`):

```css
.trow--active {
  background: var(--accent-soft);
}
```

becomes:

```css
.trow--active {
  background: var(--accent-soft);
}
.trow--cursor {
  box-shadow: inset 2px 0 0 var(--accent);
  background: #f4f2eb;
}
.trow--active.trow--cursor {
  background: var(--accent-soft);
}
```

- [ ] Add the `.mrow--cursor` rule. After the `.mrow--active` rule (`.mrow--active { background: var(--accent-soft); }`):

```css
.mrow--active {
  background: var(--accent-soft);
}
```

becomes:

```css
.mrow--active {
  background: var(--accent-soft);
}
.mrow--cursor {
  box-shadow: inset 2px 0 0 var(--accent);
  background: #f4f2eb;
}
.mrow--active.mrow--cursor {
  background: var(--accent-soft);
}
```

- [ ] Verify the UI builds: `npm run build:ui`
  - Expected: `✓ built in …`, no errors.
- [ ] Verify tests still pass: `npx vitest run`
  - Expected: all files pass.
- [ ] Manual sanity (recommended): `npm run dev`, then with focus outside the search box:
  - ↑/↓ moves a green-edged cursor highlight through folders + visible leaves; the cursored row scrolls into view.
  - → on a closed folder opens it (lazy-loads leaves); ← closes it; ↵ on a folder toggles, on a leaf opens it (↵ again drills).
  - Esc collapses a drill, else clears an active search query.
  - Switching lens / typing in the top-bar search resets the cursor and does NOT trigger nav keys while the input is focused.
- [ ] Commit:
  ```
  git add ui/src/Browser.tsx ui/src/TreePane.tsx ui/src/useBrowser.ts ui/src/styles.css
  git commit -m "$(cat <<'EOF'
  feat(ui): full keyboard navigation over the tree and lists

  Global keydown (palette-closed, focus outside inputs): ↑↓ move the cursor,
  →← expand/collapse folders, ↵ activate (toggle folder / open leaf, drill if
  already selected), Esc step back. TreePane renders a --cursor highlight and
  scrolls the cursored row into view; folders carry an empty-key cursor address.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-review notes

- **Build system is Vite, not esbuild.** The plan brief said "bundled by esbuild" — the repo actually uses `vite build ui` (`@vitejs/plugin-react`), which transforms TS via esbuild internally without typechecking. The practical guidance is unchanged and correct: verify with `npm run build:ui`, never `tsc -p ui`, and `@types/react` is genuinely absent (verified). All build commands in this plan are the real `package.json` scripts.
- **Top-bar search is preserved** (decision recorded in Task 2); ⌘K is purely additive. The nav-key handler explicitly bails when focus is in an INPUT/TEXTAREA, so typing in the top-bar search never steals arrow keys.
- **Folder-cursor representation — ambiguity resolved.** The brief specified `cursorAddress` for highlighting but folders have no key. Rather than add a second prop, folders are encoded as `(namespace, "")`. `selected` is always a real opened memory (never empty key), so `--active` and `--cursor` styles can't collide, and the empty key sorts cleanly against real keys. This is the smallest change that lets one `Selected`-shaped prop highlight both folders and leaves. Flagging it as the one non-obvious design call.
- **TDZ / declaration order.** `cursorExpand/Collapse/Activate` reference `toggleFolder` and `open`, which are declared later in the function. This is safe because the callbacks execute at event time, and those identifiers are intentionally omitted from the dependency arrays (mirroring the existing `expandAll`→`ensureLeaf` relationship, which has the same shape). If a future lint rule (`react-hooks/exhaustive-deps`) is added it will flag these — acceptable and consistent with existing code; do not "fix" by reordering, which would create a real TDZ.
- **`flattenVisible` mirrors `FolderRow` render order exactly** (folder, then children, then own leaves), so the keyboard cursor index lines up 1:1 with what's painted. The TDD test for nested expansion locks that ordering in. If `TreePane`'s render order ever changes, the util's test must change with it — they are coupled by contract, which is why the test asserts the full ordered array, not just membership.
- **Cursor reset** is keyed on `[lens, query]` only (not on expand/collapse), so toggling folders keeps the cursor where it is. `moveCursor` clamps to `[0, len-1]`, and `navItems` shrinking (e.g. collapsing a folder) is tolerated because `cursorAddress` re-derives from the live `navItems[cursor]` and simply yields a different (or null) highlight rather than crashing — consistent with "crash on impossible states" since there is no invariant violated here.
- **No backend change**, consistent with the spec's P2 scope for Navigation (palette reuses `recall`; nav reuses tree/flat/search state already loaded).
- **Scope honesty:** keyboard nav is split across Tasks 3–5 as the brief requested. Each task ends green (builds + tests pass) and is independently committed, so a reviewer can bisect.
