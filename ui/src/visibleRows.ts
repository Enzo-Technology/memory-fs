// Pure: the ordered list of currently-visible navigable rows for the Namespaces tree, so the
// keyboard cursor in useBrowser indexes a flat list instead of re-walking the tree. Depth-first —
// emit each folder; if expanded, recurse into its child folders, then (only once its leaves have
// lazy-loaded) emit its own leaf rows. Mirrors FolderRow's render order in TreePane. The flat/search
// lenses don't need this (their nav list is just the rows) — handled in useBrowser.
import type { TreeNode } from "./namespaceTree";
import type { Row } from "./useBrowser";

export type NavItem =
  | { kind: "folder"; namespace: string }
  | { kind: "leaf"; namespace: string; key: string };

export function flattenVisible(
  tree: TreeNode[],
  expanded: Set<string>,
  leaves: Record<string, Row[]>,
): NavItem[] {
  const out: NavItem[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      out.push({ kind: "folder", namespace: node.namespace });
      if (!expanded.has(node.namespace)) continue;
      walk(node.children);
      if (node.count > 0 && node.namespace in leaves) {
        for (const r of leaves[node.namespace]!) {
          out.push({ kind: "leaf", namespace: r.namespace, key: r.key });
        }
      }
    }
  };
  walk(tree);
  return out;
}
