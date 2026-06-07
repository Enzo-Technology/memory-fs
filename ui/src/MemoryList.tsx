// Search box + the current list. Renders search results when present; otherwise switches on the
// browse lens: namespaces → drill-in folder rows; recent/hubs/orphans → openable memory rows.
// Props only — the kind→render mapping is presentation, the data shaping lives upstream.
// Styling: .list / .item / .addr / .tdot (forest-green address, muted type dot per Foundations).
import type { BrowseResult } from "../../src/core/store";
import type { MemoryType } from "../../src/core/db";
import type { Row } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";

export function MemoryList({
  query,
  onQuery,
  browse,
  results,
  onOpen,
  onNamespace,
}: {
  query: string;
  onQuery: (q: string) => void;
  browse: BrowseResult | null;
  results: Row[] | null;
  onOpen: (namespace: string, key: string) => void;
  onNamespace: (namespace: string) => void;
}) {
  return (
    <section className="list">
      <input
        className="list__search"
        value={query}
        placeholder="Search…"
        onChange={(e) => onQuery(e.target.value)}
      />
      {results
        ? results.map((r) => (
            <Item
              key={`${r.namespace}/${r.key}`}
              namespace={r.namespace}
              itemKey={r.key}
              type={r.type}
              snippet={r.snippet}
              onClick={() => onOpen(r.namespace, r.key)}
            />
          ))
        : renderBrowse(browse, onOpen, onNamespace)}
    </section>
  );
}

function renderBrowse(
  browse: BrowseResult | null,
  onOpen: (namespace: string, key: string) => void,
  onNamespace: (namespace: string) => void,
) {
  if (!browse) return <p>…</p>;
  if (browse.kind === "namespaces") {
    return browse.items.map((n) => (
      <Item
        key={n.namespace}
        namespace={n.namespace}
        snippet={`${n.count} memories`}
        onClick={() => onNamespace(n.namespace)}
      />
    ));
  }
  if (browse.kind === "recent" || browse.kind === "hubs" || browse.kind === "orphans") {
    return browse.items.map((m) => (
      <Item
        key={`${m.namespace}/${m.key}`}
        namespace={m.namespace}
        itemKey={m.key}
        type={m.type}
        snippet={m.snippet}
        onClick={() => onOpen(m.namespace, m.key)}
      />
    ));
  }
  return null; // index/tags not reachable from the facet set
}

// One row. A folder (namespace lens) has no key/type and shows just its address + count; a memory
// shows ns/key with a type-colored dot. The namespace segment is forest green — it travels.
function Item({
  namespace,
  itemKey,
  type,
  snippet,
  onClick,
}: {
  namespace: string;
  itemKey?: string;
  type?: MemoryType;
  snippet: string;
  onClick: () => void;
}) {
  return (
    <button className="item" onClick={onClick}>
      <div className="item__head">
        <span className="addr">
          <span className="addr__ns">{namespace}</span>
          {itemKey && (
            <>
              <span className="addr__sep">/</span>
              <span className="addr__key">{itemKey}</span>
            </>
          )}
        </span>
        {type && <span className="tdot" style={{ background: TYPE_COLOR[type].fg }} />}
      </div>
      <span className="item__snippet">{snippet}</span>
    </button>
  );
}
