// The data layer: the only place that knows endpoint URLs and that the cookie must travel
// (credentials: "include"). Response shapes are imported (type-only) from the server's store
// types — never re-declared here — so the only client↔server coupling is the URL strings.
import type { BrowseResult, ReadResult } from "../../src/core/store";
import type { Memory } from "../../src/core/db";

// The browse lenses the UI exposes (subset of the store's BrowseKind: no "index"/"tags" — see
// the spec's deferred-tags note).
export type Facet = "recent" | "namespaces" | "hubs" | "orphans";

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

export function listMemories(facet: Facet, namespace?: string): Promise<BrowseResult> {
  const p = new URLSearchParams({ kind: facet });
  if (namespace) p.set("namespace", namespace);
  return get<BrowseResult>(`/api/memories?${p.toString()}`);
}

export function recall(query: string): Promise<Memory[]> {
  return get<Memory[]>(`/api/memories/recall?q=${encodeURIComponent(query)}`);
}

export function readMemory(namespace: string, key: string): Promise<ReadResult> {
  return get<ReadResult>(
    `/api/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
  );
}
