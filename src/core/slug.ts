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

export function deriveKey(content: string): string {
  const heading = content.match(/^#+\s+(.+)$/m);
  if (heading) return slugify(heading[1]!);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  const firstWords = firstLine.split(/\s+/).slice(0, 8).join(" ");
  return slugify(firstWords);
}
