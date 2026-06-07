// The address IS the route: a memory lives at /:namespace/:key so it is linkable and
// back/forward work. The namespace's structural colons are URL-encoded (%3A) in the path and
// decoded on read, matching the server's decodeURIComponent in /api/memories/:ns/:key. Pure and
// unit-tested — no React, no history side effects (those live in useBrowser).

export function addressToPath(namespace: string, key: string): string {
  return `/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
}

export function parseAddress(
  pathname: string,
): { namespace: string; key: string } | null {
  // Exactly two non-empty segments. Single-segment routes (/sign-in, /consent) and root
  // return null, so the reserved screens never parse as an address.
  const m = pathname.match(/^\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return {
    namespace: decodeURIComponent(m[1]!),
    key: decodeURIComponent(m[2]!),
  };
}
