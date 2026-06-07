// One memory: its content as text, plus its depth-1 neighbourhood (children + backlinks) as
// clickable rows — that is the wikilink/backlink navigation. The `read` call already returns the
// neighbourhood, so no extra fetching here. Props only. Styling: .detail / .detail__content /
// .neighbours.
import type { ReadResult } from "../../src/core/store";

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
  return (
    <section className="detail">
      <header className="detail__header">
        <strong>{detail.namespace}/{detail.key}</strong>
        <div className="detail__type">{detail.type}</div>
      </header>
      <pre className="detail__content">{detail.content}</pre>
      <Neighbours title="Links" items={detail.children} onNavigate={onNavigate} />
      <Neighbours title="Backlinks" items={detail.backlinks} onNavigate={onNavigate} />
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
