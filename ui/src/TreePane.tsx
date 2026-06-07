// The left pane. Three render modes, chosen by state: search results > flat lens list > the
// namespace tree. Finder-style disclosure (multiple branches open at once); leaf-folder contents
// lazy-load with a quiet skeleton. Leaves show a type dot only (per-leaf backlink count is P2 —
// the recent payload carries no degree and P1 adds no backend). Props only.
// Styling: .tree / .trow / .mrow.
import type { Lens } from "./api";
import type { TreeNode } from "./namespaceTree";
import type { Row } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";

type Selected = { namespace: string; key: string } | null;

function paneTitle(lens: Lens, query: string): string {
  if (query.trim()) return "Results";
  return { namespaces: "Namespaces", recent: "Recent", hubs: "Hubs", orphans: "Orphans" }[lens];
}

function emptyLensMessage(lens: Lens): string {
  if (lens === "orphans") return "No orphans — everything here is linked.";
  if (lens === "hubs") return "No hubs yet — nothing is linked to.";
  return "Nothing here yet.";
}

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
  return (
    <aside className="tree">
      <div className="tree__header">
        <span className="tree__title">{paneTitle(lens, query)}</span>
        {lens === "namespaces" && !query.trim() && (
          <button className="tree__expand" onClick={onExpandAll}>
            expand all
          </button>
        )}
      </div>
      <div className="tree__body">
        {renderBody({ lens, query, tree, expanded, leaves, flat, results, selected, onToggle, onOpen })}
      </div>
    </aside>
  );
}

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
  // Search results take precedence whenever a query is active.
  if (p.query.trim()) {
    if (!p.results) return <div className="tree__skeleton">…</div>;
    if (p.results.length === 0)
      return <p className="tree__empty">No matches. Try a broader term.</p>;
    return p.results.map((r) => (
      <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
    ));
  }

  // The tree lens.
  if (p.lens === "namespaces") {
    if (!p.tree) return <div className="tree__skeleton">…</div>;
    if (p.tree.length === 0)
      return <p className="tree__empty">Agents haven&apos;t written anything here yet.</p>;
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
  }

  // A flat lens (Recent / Hubs / Orphans).
  if (!p.flat) return <div className="tree__skeleton">…</div>;
  if (p.flat.length === 0) return <p className="tree__empty">{emptyLensMessage(p.lens)}</p>;
  return p.flat.map((r) => (
    <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} onOpen={p.onOpen} />
  ));
}

// A folder (and, when open, its child folders then its own memory leaves). Indent is 20px/depth.
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
        <span className={isOpen ? "chev chev--open" : "chev"}>{expandable ? "▸" : ""}</span>
        <span className="trow__name">{node.name}</span>
        <span className="trow__count">{node.total}</span>
      </button>
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
            ) : (
              <div className="trow trow--skeleton" style={childIndent}>
                …
              </div>
            ))}
        </>
      )}
    </>
  );
}

// A memory inside the tree: type dot + key. Active when it is the selected address.
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
      <span className="tdot" style={{ background: TYPE_COLOR[row.type].fg }} />
      <span className="trow__key">{row.key}</span>
    </button>
  );
}

// A full memory row for the flat/search lists: address + optional metric + type dot, then snippet.
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
      <div className="mrow__head">
        <span className="addr">
          <span className="addr__ns">{row.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{row.key}</span>
        </span>
        {row.metric !== undefined && <span className="mrow__metric">{row.metric}↳</span>}
        <span className="tdot" style={{ background: TYPE_COLOR[row.type].fg }} />
      </div>
      <span className="mrow__snippet">{row.snippet}</span>
    </button>
  );
}
