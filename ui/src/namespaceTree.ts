// The IA's core logic: the server stores `namespace` as a flat colon-joined string and lists
// distinct namespaces with counts; the folder hierarchy is derived HERE by splitting on ':' and
// folding segments into a tree. A node can be both a leaf (own memories, count > 0) and a folder
// (children). Pure — fetched once, cached, rebuilt client-side; unit-tested in isolation.
import type { NamespaceItem } from "../../src/core/store";

export interface TreeNode {
  name: string; // the last segment, e.g. "onboarding"
  namespace: string; // full colon-joined path, e.g. "voice:onboarding"
  count: number; // memories stored EXACTLY at this namespace (0 if purely a folder)
  total: number; // count + every descendant's count (the folder badge)
  children: TreeNode[]; // child folders, sorted alphabetically
}

export function buildTree(items: NamespaceItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  // Find-or-create the node for a segment path, wiring it under its parent (recursively
  // synthesizing intermediate folders that have no memories of their own).
  const ensure = (segments: string[]): TreeNode => {
    const path = segments.join(":");
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: TreeNode = {
      name: segments[segments.length - 1]!,
      namespace: path,
      count: 0,
      total: 0,
      children: [],
    };
    byPath.set(path, node);
    if (segments.length === 1) roots.push(node);
    else ensure(segments.slice(0, -1)).children.push(node);
    return node;
  };

  for (const item of items) ensure(item.namespace.split(":")).count = item.count;

  // Sort children alphabetically and roll up totals bottom-up.
  const finalize = (node: TreeNode): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.total =
      node.count + node.children.reduce((sum, c) => sum + finalize(c), 0);
    return node.total;
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of roots) finalize(r);

  return roots;
}
