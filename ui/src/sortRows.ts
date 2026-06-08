// Sort memory rows alphabetically by address (namespace, then key). Pure and non-mutating —
// returns a new array. Used by the "All" lens to present a complete, stably-ordered list. Generic
// over the address shape so it carries no React dependency (unit-tested in isolation).
export function sortByAddress<T extends { namespace: string; key: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key),
  );
}
