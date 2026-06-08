// Pure client tokenizer for the reading pane. Splits a memory body into ordered text/link tokens
// so Reader can render prose unchanged while making wikilinks navigable. Mirrors the tokenizing
// rules of src/core/wikilinks.ts (no linkifying inside ```fences```, `inline code`, or [[[triple]]]
// escapes; ns:key / ns/key / default-namespace resolution) — but emits those skipped regions as
// text (so the body is preserved) and does NOT dedup (every occurrence renders in place).
// A token's `namespace`/`key` are normalized to the canonical stored address (the same slug the
// server applies when it records the link), so Reader's resolvability check against the read
// payload's `children` matches even when the authored link text isn't already slugged. `raw`
// preserves the text as written, for display. Resolvability (dangling vs navigable) is decided in
// Reader, not here.
import { normalizeKey, normalizeNamespace } from "../../src/core/slug";

export type Token =
  | { kind: "text"; text: string }
  | { kind: "link"; raw: string; namespace: string; key: string };

// Regions where [[...]] must NOT be treated as a link. Mirrors src/core/wikilinks.ts.
const SKIP = /```[\s\S]*?```|`[^`\n]*`|\[\[\[[^\]]*\]\]\]/g;
const LINK = /\[\[([^\[\]\n]+?)\]\]/g;

// Split raw `[[ inner ]]` text into (namespace, key). ns:key wins over ns/key when the colon comes
// first; otherwise the whole thing is a key in the default namespace. Identical to the server.
function resolve(raw: string, defaultNamespace: string): { namespace: string; key: string } {
  const colon = raw.indexOf(":");
  const slash = raw.indexOf("/");
  if (colon !== -1 && (slash === -1 || colon < slash)) {
    const cut = raw.indexOf("/", colon);
    if (cut === -1) return { namespace: raw.slice(0, colon), key: raw.slice(colon + 1) };
    return { namespace: raw.slice(0, cut), key: raw.slice(cut + 1) };
  }
  return { namespace: defaultNamespace, key: raw };
}

// Tokenize the part of `content` between [start, end) that is known to be link-eligible (no skip
// regions). Pushes text/link tokens onto `out`. Empty/invalid brackets fall through as text.
function tokenizeRegion(
  content: string,
  start: number,
  end: number,
  defaultNamespace: string,
  out: Token[],
): void {
  LINK.lastIndex = start;
  let cursor = start;
  let m: RegExpExecArray | null;
  while ((m = LINK.exec(content)) !== null && m.index < end) {
    const raw = m[1]!.trim();
    const parsed = resolve(raw, defaultNamespace);
    const namespace = parsed.namespace.trim();
    const key = parsed.key.trim();
    if (!namespace || !key) continue; // empty bracket → leave as text (check before normalizing)
    if (m.index > cursor) pushText(out, content.slice(cursor, m.index));
    // Normalize to the canonical stored address so resolvability matches `children`; keep `raw`.
    out.push({
      kind: "link",
      raw,
      namespace: normalizeNamespace(namespace),
      key: normalizeKey(key),
    });
    cursor = m.index + m[0].length;
  }
  if (cursor < end) pushText(out, content.slice(cursor, end));
}

function pushText(out: Token[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "text") {
    last.text += text;
  } else {
    out.push({ kind: "text", text });
  }
}

export function tokenize(content: string, defaultNamespace: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  SKIP.lastIndex = 0;
  let s: RegExpExecArray | null;
  while ((s = SKIP.exec(content)) !== null) {
    // Link-eligible text before this skip region.
    tokenizeRegion(content, cursor, s.index, defaultNamespace, out);
    // The skip region itself is emitted verbatim as text, merged with any preceding text token.
    pushText(out, s[0]);
    cursor = s.index + s[0].length;
  }
  tokenizeRegion(content, cursor, content.length, defaultNamespace, out);
  return out;
}
