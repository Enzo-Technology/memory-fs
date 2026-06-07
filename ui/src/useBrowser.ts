// All browser state and orchestration: which lens is active, the search query, and the
// selected memory. Renders nothing — it hands a view-model + actions to the panes. This is the
// deep module; the panes are thin over it.
import { useEffect, useState } from "react";
import { listMemories, readMemory, recall, type Facet } from "./api";
import type { BrowseResult, ReadResult } from "../../src/core/store";
import type { MemoryType } from "../../src/core/db";

export interface Row {
  namespace: string;
  key: string;
  type: MemoryType;
  snippet: string;
}

export interface BrowserView {
  facet: Facet;
  query: string;
  browse: BrowseResult | null; // raw lens result (panes read .kind to render)
  results: Row[] | null; // search results; non-null only while a query is active
  detail: ReadResult | null;
  selectFacet: (f: Facet) => void;
  selectNamespace: (ns: string) => void;
  setQuery: (q: string) => void;
  open: (namespace: string, key: string) => void;
}

export function useBrowser(): BrowserView {
  const [facet, setFacet] = useState<Facet>("recent");
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [results, setResults] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<{ namespace: string; key: string } | null>(null);
  const [detail, setDetail] = useState<ReadResult | null>(null);

  // List source: a non-empty query searches; otherwise the active lens drives the list.
  useEffect(() => {
    let live = true;
    const trimmed = query.trim();
    if (trimmed) {
      recall(trimmed).then((ms) => {
        if (live)
          setResults(
            ms.map((m) => ({
              namespace: m.namespace,
              key: m.key,
              type: m.type,
              snippet: m.content.slice(0, 140),
            })),
          );
      });
    } else {
      listMemories(facet, namespace).then((b) => {
        if (live) {
          setBrowse(b);
          setResults(null);
        }
      });
    }
    return () => {
      live = false;
    };
  }, [facet, namespace, query]);

  // Detail source.
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

  return {
    facet,
    query,
    browse,
    results,
    detail,
    selectFacet: (f) => {
      setQuery("");
      setNamespace(undefined);
      setFacet(f);
    },
    selectNamespace: (ns) => {
      setQuery("");
      setFacet("recent");
      setNamespace(ns);
    },
    setQuery,
    open: (ns, key) => setSelected({ namespace: ns, key }),
  };
}
