export interface WikilinkRef {
  namespace: string;
  key: string;
}

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const TRIPLE = /\[\[\[[^\]]*\]\]\]/g;
const LINK = /\[\[([^\[\]\n]+?)\]\]/g;

export function parseWikilinks(
  content: string,
  defaultNamespace: string,
): WikilinkRef[] {
  const stripped = content
    .replace(FENCE, "")
    .replace(INLINE_CODE, "")
    .replace(TRIPLE, "");
  const seen = new Set<string>();
  const out: WikilinkRef[] = [];
  for (const match of stripped.matchAll(LINK)) {
    const raw = match[1]!.trim();
    if (!raw) continue;
    const colon = raw.indexOf(":");
    const slash = raw.indexOf("/");
    let namespace: string;
    let key: string;
    if (colon !== -1 && (slash === -1 || colon < slash)) {
      const cut = raw.indexOf("/", colon);
      if (cut === -1) {
        namespace = raw.slice(0, colon);
        key = raw.slice(colon + 1);
      } else {
        namespace = raw.slice(0, cut);
        key = raw.slice(cut + 1);
      }
    } else {
      namespace = defaultNamespace;
      key = raw;
    }
    namespace = namespace.trim();
    key = key.trim();
    if (!namespace || !key) continue;
    const sig = `${namespace}\x00${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ namespace, key });
  }
  return out;
}
