// The data layer: the only place that knows endpoint URLs and that the cookie must travel
// (credentials: "include"). Response shapes are imported (type-only) from the server's store
// types — never re-declared here — so the only client↔server coupling is the URL strings.
import type { BrowseResult, NamespaceItem, ReadResult } from "../../src/core/store";
import type { Memory } from "../../src/core/db";

// The flat lenses that resolve to openable memory rows (used both as a top-level lens and, with a
// namespace, to fetch one folder's leaves). "namespaces" is the tree and is fetched separately.
export type FlatLens = "recent" | "hubs" | "orphans";
export type Lens = "namespaces" | FlatLens;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  // The API 401s when the session is absent/expired; bounce to sign-in (private surface).
  if (res.status === 401) {
    location.href = "/sign-in";
    throw new Error("unauthenticated");
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// The namespace vocabulary, fetched once and folded into the tree client-side. Returns the
// store-wide memory `total` alongside, so the running total needs no extra call. Limit is raised
// past the store default (20) so the tree shows every namespace.
export async function listNamespaces(): Promise<{
  items: NamespaceItem[];
  total: number;
}> {
  const b = await get<BrowseResult>(`/api/memories?kind=namespaces&limit=1000`);
  if (b.kind !== "namespaces") throw new Error("expected namespaces result");
  return { items: b.items, total: b.total };
}

export function listMemories(kind: FlatLens, namespace?: string): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind, limit: "100" });
  if (namespace) p.set("namespace", namespace);
  return get<BrowseResult>(`/api/memories?${p.toString()}`);
}

export function recall(query: string): Promise<Memory[]> {
  // The server defaults recall to 5 hits; the search pane is a left-rail list, so lift the cap to
  // match the lens lists (a 5-result ceiling reads as "search is broken").
  return get<Memory[]>(`/api/memories/recall?q=${encodeURIComponent(query)}&limit=50`);
}

export function readMemory(namespace: string, key: string): Promise<ReadResult> {
  return get<ReadResult>(
    `/api/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
  );
}
