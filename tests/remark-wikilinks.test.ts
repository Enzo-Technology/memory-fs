import { describe, expect, it } from "vitest";
import { resolveWikilink, splitWikilinkText } from "../ui/src/remarkWikilinks.js";

describe("resolveWikilink", () => {
  const ns = "project:enzo";

  it("passes an already-slugged address through unchanged", () => {
    expect(resolveWikilink("auth-decision", ns)).toEqual({
      namespace: ns,
      key: "auth-decision",
    });
  });

  it("resolves and normalizes the ns:key form", () => {
    expect(resolveWikilink("Project:Web Stuff/Auth Decision", ns)).toEqual({
      namespace: "project:web-stuff",
      key: "auth-decision",
    });
  });

  it("uses the default namespace for a bare key, slugging the slash", () => {
    expect(resolveWikilink("notes/a", ns)).toEqual({
      namespace: ns,
      key: "notes-a",
    });
  });
});

describe("splitWikilinkText", () => {
  const ns = "project:enzo";

  it("returns a single text item for plain content", () => {
    expect(splitWikilinkText("just prose, no links", ns)).toEqual([
      { kind: "text", text: "just prose, no links" },
    ]);
  });

  it("splits a single link, carrying raw + resolved address", () => {
    expect(splitWikilinkText("see [[auth-decision]] now", ns)).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", raw: "auth-decision", namespace: ns, key: "auth-decision" },
      { kind: "text", text: " now" },
    ]);
  });

  it("handles text + link + text", () => {
    expect(splitWikilinkText("a [[x]] b", ns)).toEqual([
      { kind: "text", text: "a " },
      { kind: "link", raw: "x", namespace: ns, key: "x" },
      { kind: "text", text: " b" },
    ]);
  });

  it("handles two links", () => {
    expect(splitWikilinkText("[[x]] [[y]]", ns)).toEqual([
      { kind: "link", raw: "x", namespace: ns, key: "x" },
      { kind: "text", text: " " },
      { kind: "link", raw: "y", namespace: ns, key: "y" },
    ]);
  });

  it("leaves an empty [[]] bracket as text", () => {
    expect(splitWikilinkText("a [[]] b", ns)).toEqual([
      { kind: "text", text: "a [[]] b" },
    ]);
  });

  it("leaves a whitespace-only [[ ]] bracket as text", () => {
    expect(splitWikilinkText("a [[ ]] b", ns)).toEqual([
      { kind: "text", text: "a [[ ]] b" },
    ]);
  });
});
