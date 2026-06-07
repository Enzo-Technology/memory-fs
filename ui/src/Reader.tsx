// The reading pane. Split (home) and drill (full-page focus) are one component switched by `mode`,
// sharing the single `read` payload (memory + depth-1 children/backlinks with snippets — no extra
// fetch). Title is the first content line (never invented). In drill, neighbours gain snippets.
// Props only. Styling: .reader.
import type { ReadResult } from "../../src/core/store";
import type { Mode } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";

function firstLine(content: string): string {
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

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
  const color = TYPE_COLOR[detail.type];
  const title = firstLine(detail.content) || detail.key;
  const drilled = mode === "drill";
  return (
    <section className={drilled ? "reader reader--drill" : "reader"}>
      <div className="reader__bar">
        <span className="addr">
          <span className="addr__ns">{detail.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{detail.key}</span>
        </span>
        {drilled ? (
          <button className="reader__toggle" onClick={onShowTree}>
            show tree
          </button>
        ) : (
          <button className="reader__toggle" onClick={onDrill}>
            focus
          </button>
        )}
      </div>
      <article className="reader__doc">
        <span className="chip" style={{ color: color.fg, background: color.bg }}>
          <span className="cdot" style={{ background: color.fg }} />
          {detail.type}
        </span>
        <h1 className="reader__title">{title}</h1>
        <pre className="reader__content">{detail.content}</pre>
        {(detail.children.length > 0 || detail.backlinks.length > 0) && (
          <div className="reader__rel">
            <Neighbours
              title="Links out"
              items={detail.children}
              withSnippet={drilled}
              onNavigate={onNavigate}
            />
            <Neighbours
              title="Backlinks"
              items={detail.backlinks}
              withSnippet={drilled}
              onNavigate={onNavigate}
            />
          </div>
        )}
        {detail.tags.length > 0 && (
          <div className="reader__tags">
            {detail.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function Neighbours({
  title,
  items,
  withSnippet,
  onNavigate,
}: {
  title: string;
  items: ReadResult["children"];
  withSnippet: boolean;
  onNavigate: (namespace: string, key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="neighbours">
      <em>
        {title} · {items.length}
      </em>
      {items.map((n) => (
        <button
          key={`${n.namespace}/${n.key}`}
          className="neighbour"
          onClick={() => onNavigate(n.namespace, n.key)}
        >
          <span className="neighbour__addr">
            {n.namespace}/{n.key}
          </span>
          {withSnippet && <span className="neighbour__snippet">{n.snippet}</span>}
        </button>
      ))}
    </div>
  );
}
