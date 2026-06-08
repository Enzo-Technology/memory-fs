// The left pane. Four render modes, chosen by state: search results > tags: vocabulary, or back
// row + a tag's memories > flat lens list > the namespace tree. Finder-style disclosure (multiple
// branches open at once); leaf-folder contents lazy-load with a quiet skeleton. Leaves show a
// type dot only (per-leaf backlink count is P2 — the recent payload carries no degree and P1 adds
// no backend). Props only.
// Styling: .tree / .trow / .mrow / .tagrow.
import { useEffect, useRef } from "react";
import type { Lens } from "./api";
import type { TreeNode } from "./namespaceTree";
import type { Row } from "./useBrowser";
import type { TagItem } from "../../src/core/store";
import { TYPE_COLOR } from "./memoryType";

type Selected = { namespace: string; key: string } | null;

function paneTitle(lens: Lens, query: string, selectedTag: string | null): string {
  if (query.trim()) return "Results";
  if (lens === "tags") return selectedTag ? `#${selectedTag}` : "Tags";
  return { namespaces: "Namespaces", all: "All", recent: "Recent", hubs: "Hubs", orphans: "Orphans" }[lens];
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
  flatError,
  results,
  resultsError,
  selected,
  cursorAddress,
  tags,
  selectedTag,
  onToggle,
  onOpen,
  onExpandAll,
  onSelectTag,
  onClearTag,
}: {
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
  cursorAddress: Selected;
  tags: TagItem[] | null;
  selectedTag: string | null;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
  onExpandAll: () => void;
  onSelectTag: (tag: string) => void;
  onClearTag: () => void;
}) {
  return (
    <aside className="tree">
      <div className="tree__header">
        <span className="tree__title">{paneTitle(lens, query, selectedTag)}</span>
        {lens === "namespaces" && !query.trim() && (
          <button className="tree__expand" onClick={onExpandAll}>
            expand all
          </button>
        )}
      </div>
      <div className="tree__body">
        {renderBody({ lens, query, tree, expanded, leaves, flat, flatError, results, resultsError, selected, cursorAddress, tags, selectedTag, onToggle, onOpen, onSelectTag, onClearTag })}
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
  flatError: boolean;
  results: Row[] | null;
  resultsError: boolean;
  selected: Selected;
  cursorAddress: Selected;
  tags: TagItem[] | null;
  selectedTag: string | null;
  onToggle: (node: TreeNode) => void;
  onOpen: (namespace: string, key: string) => void;
  onSelectTag: (tag: string) => void;
  onClearTag: () => void;
}) {
  // Search results take precedence whenever a query is active.
  if (p.query.trim()) {
    if (p.resultsError)
      return <p className="tree__error">Couldn&apos;t load results — retry?</p>;
    if (!p.results) return <div className="tree__skeleton">…</div>;
    if (p.results.length === 0)
      return <p className="tree__empty">No matches. Try a broader term.</p>;
    return p.results.map((r) => (
      <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} cursor={p.cursorAddress} onOpen={p.onOpen} />
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
        cursor={p.cursorAddress}
        onToggle={p.onToggle}
        onOpen={p.onOpen}
      />
    ));
  }

  // The Tags lens: vocabulary first; once a tag is picked, a back row then its memories (flat).
  if (p.lens === "tags") {
    if (!p.selectedTag) {
      if (!p.tags) return <div className="tree__skeleton">…</div>;
      if (p.tags.length === 0)
        return <p className="tree__empty">No tags yet.</p>;
      return p.tags.map((t) => (
        <button
          key={t.tag}
          className="tagrow"
          onClick={() => p.onSelectTag(t.tag)}
        >
          <span className="tagrow__name">#{t.tag}</span>
          <span className="tagrow__count">{t.count}</span>
        </button>
      ));
    }
    if (p.flatError) return <p className="tree__error">Couldn&apos;t load — retry?</p>;
    if (!p.flat) return <div className="tree__skeleton">…</div>;
    return (
      <>
        <button className="tagrow tagrow--back" onClick={p.onClearTag}>
          ← all tags
        </button>
        {p.flat.length === 0 ? (
          <p className="tree__empty">Nothing tagged #{p.selectedTag}.</p>
        ) : (
          p.flat.map((r) => (
            <MemoryRow
              key={`${r.namespace}/${r.key}`}
              row={r}
              selected={p.selected}
              cursor={p.cursorAddress}
              onOpen={p.onOpen}
            />
          ))
        )}
      </>
    );
  }

  // A flat lens (Recent / Hubs / Orphans).
  if (p.flatError)
    return <p className="tree__error">Couldn&apos;t load — retry?</p>;
  if (!p.flat) return <div className="tree__skeleton">…</div>;
  if (p.flat.length === 0) return <p className="tree__empty">{emptyLensMessage(p.lens)}</p>;
  return p.flat.map((r) => (
    <MemoryRow key={`${r.namespace}/${r.key}`} row={r} selected={p.selected} cursor={p.cursorAddress} onOpen={p.onOpen} />
  ));
}

// A folder (and, when open, its child folders then its own memory leaves). Indent is 20px/depth.
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
      <span className="tdot" style={{ background: TYPE_COLOR[row.type].fg }} />
      <span className="trow__key">{row.key}</span>
    </button>
  );
}

// A full memory row for the flat/search lists: address + optional metric + type dot, then snippet.
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

// Scroll the cursored row into view when it becomes the cursor. `block: "nearest"` avoids
// yanking the whole pane when the row is already visible.
function useScrollIntoView(active: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return ref;
}
