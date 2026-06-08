import { describe, expect, it } from "vitest";
import { buildTree } from "../ui/src/namespaceTree.js";

describe("buildTree", () => {
  it("returns [] for no namespaces", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("makes one node for a colon-free namespace", () => {
    expect(buildTree([{ namespace: "voice", count: 3 }])).toEqual([
      { name: "voice", namespace: "voice", count: 3, total: 3, children: [] },
    ]);
  });

  it("folds shared prefixes into a parent folder, children sorted alpha", () => {
    const tree = buildTree([
      { namespace: "voice:onboarding", count: 12 },
      { namespace: "voice:errors", count: 6 },
    ]);
    expect(tree).toHaveLength(1);
    const voice = tree[0]!;
    expect(voice.namespace).toBe("voice");
    expect(voice.count).toBe(0); // no memories stored at "voice" itself
    expect(voice.total).toBe(18); // sum of descendants
    expect(voice.children.map((c) => c.name)).toEqual(["errors", "onboarding"]);
    expect(voice.children.map((c) => c.count)).toEqual([6, 12]);
  });

  it("lets a node be both a leaf (own count) and a folder (children)", () => {
    const tree = buildTree([
      { namespace: "voice", count: 3 },
      { namespace: "voice:onboarding", count: 12 },
    ]);
    const voice = tree[0]!;
    expect(voice.count).toBe(3);
    expect(voice.total).toBe(15);
    expect(voice.children.map((c) => c.namespace)).toEqual(["voice:onboarding"]);
  });

  it("synthesizes intermediate folders for deep namespaces", () => {
    const tree = buildTree([{ namespace: "a:b:c", count: 4 }]);
    const a = tree[0]!;
    expect(a).toMatchObject({ name: "a", namespace: "a", count: 0, total: 4 });
    const b = a.children[0]!;
    expect(b).toMatchObject({ name: "b", namespace: "a:b", count: 0, total: 4 });
    const c = b.children[0]!;
    expect(c).toMatchObject({ name: "c", namespace: "a:b:c", count: 4, total: 4, children: [] });
  });

  it("sorts top-level nodes alphabetically", () => {
    const tree = buildTree([
      { namespace: "zeta", count: 1 },
      { namespace: "alpha", count: 1 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "zeta"]);
  });
});
