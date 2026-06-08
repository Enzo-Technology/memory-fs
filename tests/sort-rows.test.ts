import { describe, expect, it } from "vitest";
import { sortByAddress } from "../ui/src/sortRows.js";

describe("sortByAddress", () => {
  it("orders by namespace, then key", () => {
    const rows = [
      { namespace: "b", key: "x" },
      { namespace: "a", key: "z" },
      { namespace: "a", key: "a" },
    ];
    expect(sortByAddress(rows).map((r) => `${r.namespace}/${r.key}`)).toEqual([
      "a/a",
      "a/z",
      "b/x",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { namespace: "b", key: "x" },
      { namespace: "a", key: "y" },
    ];
    const before = [...rows];
    sortByAddress(rows);
    expect(rows).toEqual(before);
  });

  it("returns [] for []", () => {
    expect(sortByAddress([])).toEqual([]);
  });

  it("preserves extra fields on the rows", () => {
    const rows = [
      { namespace: "a", key: "b", type: "note", snippet: "hi" },
      { namespace: "a", key: "a", type: "user", snippet: "yo" },
    ];
    expect(sortByAddress(rows)[0]).toEqual({
      namespace: "a",
      key: "a",
      type: "user",
      snippet: "yo",
    });
  });
});
