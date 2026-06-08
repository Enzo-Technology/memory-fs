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
