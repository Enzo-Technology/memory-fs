import { describe, expect, it } from "vitest";
import { flattenVisible } from "../ui/src/visibleRows.js";
import type { TreeNode } from "../ui/src/namespaceTree.js";
import type { Row } from "../ui/src/useBrowser.js";

// Minimal builders so the tests read as IA, not plumbing.
function folder(namespace: string, count: number, children: TreeNode[] = []): TreeNode {
  const name = namespace.split(":").pop()!;
  return { name, namespace, count, total: count, children };
}
function row(namespace: string, key: string): Row {
  return { namespace, key, type: "note", snippet: "" };
}

describe("flattenVisible", () => {
  it("returns [] for an empty tree", () => {
    expect(flattenVisible([], new Set(), {})).toEqual([]);
  });

  it("yields just the folder when it is closed", () => {
    const tree = [folder("voice", 2)];
    expect(flattenVisible(tree, new Set(), { voice: [row("voice", "a")] })).toEqual([
      { kind: "folder", namespace: "voice" },
    ]);
  });

  it("yields children then own leaves when a folder is expanded", () => {
    const tree = [folder("voice", 1, [folder("voice:onboarding", 1)])];
    const expanded = new Set(["voice"]);
    const leaves = { voice: [row("voice", "tone")] };
    expect(flattenVisible(tree, expanded, leaves)).toEqual([
      { kind: "folder", namespace: "voice" },
      { kind: "folder", namespace: "voice:onboarding" },
      { kind: "leaf", namespace: "voice", key: "tone" },
    ]);
  });

  it("orders nested expansion depth-first: child folder's leaves before parent's leaves", () => {
    const tree = [folder("voice", 1, [folder("voice:onboarding", 1)])];
    const expanded = new Set(["voice", "voice:onboarding"]);
    const leaves = {
      voice: [row("voice", "tone")],
      "voice:onboarding": [row("voice:onboarding", "greeting")],
    };
    expect(flattenVisible(tree, expanded, leaves)).toEqual([
      { kind: "folder", namespace: "voice" },
      { kind: "folder", namespace: "voice:onboarding" },
      { kind: "leaf", namespace: "voice:onboarding", key: "greeting" },
      { kind: "leaf", namespace: "voice", key: "tone" },
    ]);
  });

  it("emits no leaf items when an expanded folder's leaves are not yet loaded", () => {
    const tree = [folder("voice", 2)];
    const expanded = new Set(["voice"]);
    expect(flattenVisible(tree, expanded, {})).toEqual([
      { kind: "folder", namespace: "voice" },
    ]);
  });
});
