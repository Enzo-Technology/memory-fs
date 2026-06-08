// All browser state + orchestration: active lens, search query, the namespace tree and which
// folders are open, lazily-fetched folder contents, the selected address, the reader/drill mode,
// and URL <-> selection sync. Renders nothing — hands a view-model + actions to the panes. The
// deep module; the panes are thin over it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteMemory,
  listMemories,
  listNamespaces,
  listTagged,
  listTags,
  readMemory,
  recall,
  type FlatLens,
  type Lens,
} from "./api";
import type { Backlink, BrowseResult, ReadResult, TagItem } from "../../src/core/store";
import type { MemoryType } from "../../src/core/db";
import { buildTree, type TreeNode } from "./namespaceTree";
import { addressToPath, parseAddress } from "./route";
import { sortByAddress } from "./sortRows";
import { flattenVisible, type NavItem } from "./visibleRows";

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
  flat: Row[] | null; // Recent/Hubs/Orphans/Tagged list; null while loading
  flatError: boolean; // the flat-lens fetch failed (distinguishes failure from the loading null)
  results: Row[] | null; // search results; non-null only while a query is active
  resultsError: boolean; // the search fetch failed
  tags: TagItem[] | null; // Tags-lens vocabulary; null while loading / off-lens
  selectedTag: string | null; // drilled-into tag, or null = show vocabulary
  detail: ReadResult | null;
  detailError: boolean; // the read fetch failed (distinguishes failure from the loading null)
  selected: { namespace: string; key: string } | null;
  mode: Mode;
  totals: { memories: number; namespaces: number };
  selectLens: (l: Lens) => void;
  selectTag: (tag: string | null) => void;
  setQuery: (q: string) => void;
  toggleFolder: (node: TreeNode) => void;
  expandAll: () => void;
  open: (namespace: string, key: string) => void;
  drill: () => void;
  showTree: () => void;
  pendingBacklinks: Backlink[] | null; // non-null → guardrail panel shown for `selected`
  confirmDelete: (force: boolean) => void; // run the delete; force skips the guardrail
  cancelDelete: () => void; // dismiss the guardrail panel
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

// First non-empty line of content — the de-facto title/snippet (the store never stores a title).
function firstLine(content: string): string {
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

// Map a flat browse result to openable rows. Hubs carry in_degree as the metric.
function toRows(b: BrowseResult): Row[] {
  if (b.kind === "recent" || b.kind === "orphans" || b.kind === "tagged") {
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

export function useBrowser(): BrowserView {
  const [lens, setLens] = useState<Lens>("namespaces");
  const [query, setQuery] = useState("");
  const [namespaceItems, setNamespaceItems] = useState<
    { namespace: string; count: number }[] | null
  >(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [leaves, setLeaves] = useState<Record<string, Row[]>>({});
  const [flat, setFlat] = useState<Row[] | null>(null);
  const [flatError, setFlatError] = useState(false);
  const [results, setResults] = useState<Row[] | null>(null);
  const [resultsError, setResultsError] = useState(false);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ namespace: string; key: string } | null>(
    () => parseAddress(location.pathname),
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [detail, setDetail] = useState<ReadResult | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [mode, setMode] = useState<Mode>("split");
  const [pendingBacklinks, setPendingBacklinks] = useState<Backlink[] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [totals, setTotals] = useState({ memories: 0, namespaces: 0 });
  const inflight = useRef<Set<string>>(new Set());
  const loaded = useRef<Set<string>>(new Set());

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

  // Reset the cursor when the active list's identity changes (new lens / new search).
  useEffect(() => {
    setCursor(0);
  }, [lens, query, selectedTag]);

  // The cursored row as an address: a leaf -> its (namespace,key); a folder -> (namespace,"") so
  // TreePane can highlight folders too (key "" never collides with a real memory key).
  const cursorAddress = useMemo(() => {
    const item = navItems[cursor];
    if (!item) return null;
    return item.kind === "leaf"
      ? { namespace: item.namespace, key: item.key }
      : { namespace: item.namespace, key: "" };
  }, [navItems, cursor]);

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

  // 2. Flat lens list. Skipped for the tree lens, the tags vocabulary, and while searching.
  //    "all" reuses the recent endpoint at a high limit and sorts client-side by address — a
  //    complete, stably-ordered list with no backend change (fine at team scale; see plan note on
  //    the cap). When a tag is selected the tags lens hands off here via listTagged.
  useEffect(() => {
    if (query.trim() || lens === "namespaces" || (lens === "tags" && !selectedTag)) {
      setFlat(null);
      return;
    }
    let live = true;
    setFlat(null);
    setFlatError(false);
    const load =
      lens === "tags"
        ? listTagged(selectedTag!).then((b) => ({ rows: toRows(b), total: b.total }))
        : lens === "all"
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
  }, [lens, query, selectedTag]);

  // 2b. Tags-lens vocabulary — fetched when the Tags lens is active and no tag is drilled into.
  //     Skipped while searching. Picking a tag hands off to the flat effect above (listTagged).
  useEffect(() => {
    if (lens !== "tags" || selectedTag || query.trim()) {
      setTags(null);
      return;
    }
    let live = true;
    setTags(null);
    listTags().then((items) => {
      if (live) setTags(items);
    });
    return () => {
      live = false;
    };
  }, [lens, selectedTag, query]);

  // 3. Search — a non-empty query populates the results list via recall.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
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
  }, [query]);

  // 4. Detail for the selected address.
  useEffect(() => {
    setPendingBacklinks(null);
    if (!selected) {
      setDetail(null);
      setDetailError(false);
      return;
    }
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
  }, [selected]);

  // 5. Back/forward → re-read the address from the URL (no pushState here, or we'd loop).
  useEffect(() => {
    const onPop = () => setSelected(parseAddress(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Lazy-fetch one folder's own memories the first time it opens. Dedups against both in-flight
  // and already-resolved folders via refs, so the fetch/guard stay out of the (pure) setLeaves
  // updater. Derive-don't-round-trip: only leaf contents hit the network.
  const ensureLeaf = useCallback((ns: string) => {
    if (inflight.current.has(ns) || loaded.current.has(ns)) return;
    inflight.current.add(ns);
    listMemories("recent", ns)
      .then((b) => {
        loaded.current.add(ns);
        setLeaves((c) => ({ ...c, [ns]: toRows(b) }));
      })
      .finally(() => inflight.current.delete(ns));
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
    setSelected({ namespace, key });
    history.pushState(null, "", addressToPath(namespace, key));
  }, []);

  const confirmDelete = useCallback(
    (force: boolean) => {
      if (!selected) return;
      const { namespace, key } = selected;
      deleteMemory(namespace, key, force).then((r) => {
        if ("conflict" in r) {
          setPendingBacklinks(r.backlinks);
          return;
        }
        // Gone: drop it from every cached list and the running total, then deselect.
        const drop = (rows: Row[] | null) =>
          rows
            ? rows.filter((x) => !(x.namespace === namespace && x.key === key))
            : rows;
        setFlat(drop);
        setResults(drop);
        setLeaves((c) => {
          const cur = c[namespace];
          if (!cur) return c;
          return { ...c, [namespace]: cur.filter((x) => x.key !== key) };
        });
        setTotals((t) => ({ ...t, memories: Math.max(0, t.memories - 1) }));
        setPendingBacklinks(null);
        // Only tear down the reader if we're still looking at the memory we deleted — the user
        // may have selected another memory while the delete was in flight.
        const cur = selectedRef.current;
        if (cur && cur.namespace === namespace && cur.key === key) {
          setDetail(null);
          setSelected(null);
          setMode("split");
          history.pushState(null, "", "/");
        }
      });
    },
    [selected],
  );

  const cancelDelete = useCallback(() => setPendingBacklinks(null), []);

  const selectLens = useCallback((l: Lens) => {
    setQuery("");
    setSelectedTag(null);
    setLens(l);
  }, []);

  const selectTag = useCallback((tag: string | null) => setSelectedTag(tag), []);

  return {
    lens,
    query,
    tree,
    expanded,
    leaves,
    flat,
    flatError,
    results,
    resultsError,
    tags,
    selectedTag,
    detail,
    detailError,
    selected,
    mode,
    totals,
    selectLens,
    selectTag,
    setQuery,
    toggleFolder,
    expandAll,
    open,
    drill: useCallback(() => setMode("drill"), []),
    showTree: useCallback(() => setMode("split"), []),
    pendingBacklinks,
    confirmDelete,
    cancelDelete,
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
