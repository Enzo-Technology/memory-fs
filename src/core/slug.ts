const MAX = 60;

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "note";
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 20 ? cut.slice(0, lastDash) : cut;
}

// Normalize a caller-supplied key to a safe slug, so provided and auto-derived
// keys are addressed identically (deriveKey already slugifies).
export function normalizeKey(key: string): string {
  return slugify(key);
}

// Normalize a namespace while preserving the ':' scope-separator convention
// ('Project:Web Stuff' -> 'project:web-stuff'). Slugging each segment strips the
// whitespace and '/' that would otherwise collide with [[ns/key]] addressing.
export function normalizeNamespace(namespace: string): string {
  return namespace
    .split(":")
    .map((segment) => slugify(segment))
    .join(":");
}

export function deriveKey(content: string): string {
  const heading = content.match(/^#+\s+(.+)$/m);
  if (heading) return slugify(heading[1]!);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  const firstWords = firstLine.split(/\s+/).slice(0, 8).join(" ");
  return slugify(firstWords);
}
