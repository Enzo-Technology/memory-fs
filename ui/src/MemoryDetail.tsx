// One memory: address + type chip, the key as title, content as prose, then its depth-1
// neighbourhood (children + backlinks) as two aligned columns of clickable forest-green addresses
// — the wikilink/backlink navigation. The `read` call already returns the neighbourhood, so no
// extra fetching here. Props only. Styling: .detail / .detail__content / .detail__rel.
import type { ReadResult } from "../../src/core/store";
import { TYPE_COLOR } from "./memoryType";

export function MemoryDetail({
  detail,
  onNavigate,
}: {
  detail: ReadResult | null;
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (!detail) {
    return (
      <section className="detail detail--empty">
        <p>Select a memory.</p>
      </section>
    );
  }
  const color = TYPE_COLOR[detail.type];
  return (
    <section className="detail">
      <header className="detail__header">
        <span className="addr">
          <span className="addr__ns">{detail.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{detail.key}</span>
        </span>
        <span className="chip" style={{ color: color.fg, background: color.bg }}>
          <span className="cdot" style={{ background: color.fg }} />
          {detail.type}
        </span>
      </header>
      <h1 className="detail__title">{detail.key}</h1>
      <pre className="detail__content">{detail.content}</pre>
      {(detail.children.length > 0 || detail.backlinks.length > 0) && (
        <div className="detail__rel">
          <Neighbours title={`Links · ${detail.children.length}`} items={detail.children} onNavigate={onNavigate} />
          <Neighbours title={`Backlinks · ${detail.backlinks.length}`} items={detail.backlinks} onNavigate={onNavigate} />
        </div>
      )}
    </section>
  );
}

function Neighbours({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: ReadResult["children"];
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="neighbours">
      <em>{title}</em>
      {items.map((n) => (
        <button
          key={`${n.namespace}/${n.key}`}
          className="neighbour"
          onClick={() => onNavigate(n.namespace, n.key)}
        >
          {n.namespace}/{n.key} <span className="neighbour__relation">({n.relation})</span>
        </button>
      ))}
    </div>
  );
}
