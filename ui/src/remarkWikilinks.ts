// Wikilink support for the reader's markdown pipeline. The reader renders bodies with
// react-markdown; this module owns the [[ns:key]] address logic and a remark (mdast) plugin that
// turns wikilinks into link nodes the reader styles + makes navigable.
//
// Addresses are normalized to the canonical stored slug (the same form the server records in a
// memory's `children`), so the reader's resolvability check matches even when the authored link
// text isn't already slugged. `raw` preserves the text as written, for display.
//
// Code-skipping is NOT handled here: markdown code spans/blocks parse to `inlineCode`/`code`
// mdast nodes, not `text` nodes, so the plugin (which only visits `text` nodes) never sees
// wikilinks inside code — they render literally, as intended.
import { SKIP, visit } from "unist-util-visit";
import type { Root, Text } from "mdast";
import { normalizeKey, normalizeNamespace } from "../../src/core/slug";

const LINK = /\[\[([^\[\]\n]+?)\]\]/g;

export type WikilinkPiece =
  | { kind: "text"; text: string }
  | { kind: "link"; raw: string; namespace: string; key: string };

// Parse `ns:key` / `ns/key` / bare-key-in-default-namespace, then normalize to the stored slug.
// ns:key wins over ns/key when the colon comes first; otherwise the whole thing is a key in the
// default namespace. Mirrors src/core/wikilinks.ts.
export function resolveWikilink(
  raw: string,
  defaultNamespace: string,
): { namespace: string; key: string } {
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
  return {
    namespace: normalizeNamespace(namespace.trim()),
    key: normalizeKey(key.trim()),
  };
}

// Split a string on [[...]] into ordered text/link pieces. Empty/whitespace-only brackets stay as
// text (their resolved namespace or key is empty after trimming).
export function splitWikilinkText(
  value: string,
  defaultNamespace: string,
): WikilinkPiece[] {
  const out: WikilinkPiece[] = [];
  let cursor = 0;
  LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK.exec(value)) !== null) {
    const raw = m[1]!.trim();
    if (!raw) continue; // whitespace-only bracket → leave as text
    const { namespace, key } = resolveWikilink(raw, defaultNamespace);
    if (!namespace || !key) continue; // empty after normalize → leave as text
    if (m.index > cursor) pushText(out, value.slice(cursor, m.index));
    out.push({ kind: "link", raw, namespace, key });
    cursor = m.index + m[0].length;
  }
  if (cursor < value.length) pushText(out, value.slice(cursor));
  return out;
}

function pushText(out: WikilinkPiece[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

// Remark plugin factory bound to a default namespace. Returns a unified *attacher* (the shape
// remarkPlugins expects: `(options?) => transformer`), so it slots straight into
// `remarkPlugins={[remarkGfm, remarkWikilinks(ns)]}`. The transformer visits text nodes and
// replaces each wikilink-bearing one with a mix of text + link nodes. Wikilink targets become
// mdast `link` nodes tagged with hProperties so the reader's `a` override can recognize them and
// resolve navigability.
export function remarkWikilinks(defaultNamespace: string) {
  return () => (tree: Root): void => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index === undefined || parent === undefined) return;
      const pieces = splitWikilinkText(node.value, defaultNamespace);
      // No links (single text piece) → leave the node untouched.
      if (pieces.length === 1 && pieces[0]!.kind === "text") return;
      const replacement = pieces.map((p) =>
        p.kind === "text"
          ? { type: "text" as const, value: p.text }
          : {
              type: "link" as const,
              url: "#",
              children: [{ type: "text" as const, value: p.raw }],
              data: {
                hProperties: {
                  className: ["wikilink-ref"],
                  "data-ns": p.namespace,
                  "data-key": p.key,
                },
              },
            },
      );
      parent.children.splice(index, 1, ...replacement);
      // Don't descend into the inserted nodes (their text children must not be re-split, and
      // re-visiting after a splice trips unist-util-visit's bounds handling); resume traversal at
      // the first node after the replacement.
      return [SKIP, index + replacement.length];
    });
  };
}
