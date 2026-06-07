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
