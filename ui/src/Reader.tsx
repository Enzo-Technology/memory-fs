// The reading pane. Split (home) and drill (full-page focus) are one component switched by `mode`,
// sharing the single `read` payload (memory + depth-1 children/backlinks with snippets — no extra
// fetch). Title is the first content line (never invented). In drill, neighbours gain snippets.
// Props only. Styling: .reader.
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Backlink, ReadResult } from "../../src/core/store";
import type { Mode } from "./useBrowser";
import { TYPE_COLOR } from "./memoryType";
import { remarkWikilinks } from "./remarkWikilinks";

// The first non-empty line, stripped of a leading heading marker and surrounding emphasis/code
// markers, so the title reads as plain text (e.g. `## **Brand voice**` → `Brand voice`).
function cleanTitle(content: string): string {
  const first = (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  const noHeading = first.replace(/^#{1,6}\s+/, "");
  return noHeading.replace(/^[*`]+/, "").replace(/[*`]+$/, "").trim();
}

// Drop a leading top-level heading line (and a following blank line) so the H1 that became the
// title isn't repeated in the rendered body. Non-heading content is returned unchanged.
function stripLeadingHeading(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim().length === 0) i++;
  if (i >= lines.length || !/^#{1,6}\s+/.test(lines[i]!)) return content;
  lines.splice(i, 1);
  if (i < lines.length && lines[i]!.trim().length === 0) lines.splice(i, 1);
  return lines.join("\n");
}

export function Reader({
  detail,
  mode,
  empty,
  detailError,
  selected,
  onNavigate,
  onDrill,
  onShowTree,
  pendingBacklinks,
  onDelete,
  onCancelDelete,
}: {
  detail: ReadResult | null;
  mode: Mode;
  empty: string;
  detailError: boolean;
  selected: boolean;
  onNavigate: (namespace: string, key: string) => void;
  onDrill: () => void;
  onShowTree: () => void;
  pendingBacklinks: Backlink[] | null;
  onDelete: (force: boolean) => void;
  onCancelDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
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
  const color = TYPE_COLOR[detail.type];
  const title = cleanTitle(detail.content) || detail.key;
  const drilled = mode === "drill";
  const guarded = pendingBacklinks !== null;
  return (
    <section className={drilled ? "reader reader--drill" : "reader"}>
      <div className="reader__bar">
        <span className="addr">
          <span className="addr__ns">{detail.namespace}</span>
          <span className="addr__sep">/</span>
          <span className="addr__key">{detail.key}</span>
        </span>
        <div className="reader__actions">
          {drilled ? (
            <button className="reader__toggle" onClick={onShowTree}>
              show tree
            </button>
          ) : (
            <button className="reader__toggle" onClick={onDrill}>
              focus
            </button>
          )}
          {confirming ? (
            <span className="reader__confirm">
              Delete this memory?
              <button
                className="reader__delete reader__delete--go"
                onClick={() => {
                  setConfirming(false);
                  onDelete(false);
                }}
              >
                Delete
              </button>
              <button className="reader__cancel" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              className="reader__delete"
              onClick={() => {
                onCancelDelete();
                setConfirming(true);
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <article className="reader__doc">
        {guarded && (
          <div className="guardrail">
            <p className="guardrail__lead">
              {pendingBacklinks!.length}{" "}
              {pendingBacklinks!.length === 1 ? "memory links" : "memories link"} here —
              deleting may break {pendingBacklinks!.length === 1 ? "it" : "them"}.
            </p>
            <div className="guardrail__list">
              {pendingBacklinks!.map((b) => (
                <button
                  key={`${b.from_namespace}/${b.from_key}`}
                  className="guardrail__link"
                  onClick={() => onNavigate(b.from_namespace, b.from_key)}
                >
                  {b.from_namespace}/{b.from_key}
                </button>
              ))}
            </div>
            <div className="guardrail__actions">
              <button
                className="reader__delete reader__delete--go"
                onClick={() => onDelete(true)}
              >
                Delete anyway
              </button>
              <button className="reader__cancel" onClick={onCancelDelete}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <span className="chip" style={{ color: color.fg, background: color.bg }}>
          <span className="cdot" style={{ background: color.fg }} />
          {detail.type}
        </span>
        <h1 className="reader__title">{title}</h1>
        <Body detail={detail} onNavigate={onNavigate} />
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

// The memory body, rendered as markdown (react-markdown + gfm). The remarkWikilinks plugin turns
// [[links]] into link nodes tagged with data-ns/data-key; the `a` override below makes them
// navigable. A wikilink resolves iff its (namespace,key) is an existing outbound child — dangling
// targets are omitted from the read payload's children server-side, so anything not in that set is
// muted and non-navigable (never a dead-end click). The leading heading is dropped from the body
// since it became the title. Raw HTML is left escaped by react-markdown (no rehype-raw) so
// agent-authored content can't inject markup.
function Body({
  detail,
  onNavigate,
}: {
  detail: ReadResult;
  onNavigate: (namespace: string, key: string) => void;
}) {
  const resolvable = new Set(detail.children.map((c) => `${c.namespace}\x00${c.key}`));
  const bodyMarkdown = stripLeadingHeading(detail.content);
  const components: Components = {
    a({ href, children, ...rest }) {
      // Wikilinks arrive as <a class="wikilink-ref" data-ns data-key>: react-markdown spreads the
      // plugin's hProperties straight onto props, so data-ns/data-key are readable as props["data-ns"]
      // (verified at runtime — they are NOT camelCased). Non-wikilink links lack them.
      const props = rest as Record<string, unknown>;
      const ns = props["data-ns"] as string | undefined;
      const key = props["data-key"] as string | undefined;
      if (ns !== undefined && key !== undefined) {
        if (resolvable.has(`${ns}\x00${key}`)) {
          return (
            <button className="wikilink" onClick={() => onNavigate(ns, key)}>
              {children}
            </button>
          );
        }
        return <span className="wikilink wikilink--dangling">{children}</span>;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
  };
  return (
    <div className="reader__content reader__md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWikilinks(detail.namespace)]}
        components={components}
      >
        {bodyMarkdown}
      </ReactMarkdown>
    </div>
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
