import { describe, expect, it } from "vitest";
import { parseWikilinks, type WikilinkRef } from "../src/core/wikilinks.js";

describe("parseWikilinks", () => {
  const ofNs = "project:enzo";

  it("extracts ns:key form", () => {
    expect(parseWikilinks("see [[project:enzo/auth-decision]]", ofNs)).toEqual<
      WikilinkRef[]
    >([{ namespace: "project:enzo", key: "auth-decision" }]);
  });
  it("treats bare keys as same-namespace", () => {
    expect(parseWikilinks("ref [[notes/a]] and [[notes/b]]", ofNs)).toEqual<
      WikilinkRef[]
    >([
      { namespace: ofNs, key: "notes/a" },
      { namespace: ofNs, key: "notes/b" },
    ]);
  });
  it("dedups identical refs", () => {
    expect(parseWikilinks("[[x]] and [[x]] again", ofNs)).toHaveLength(1);
  });
  it("ignores empty brackets and unclosed", () => {
    expect(parseWikilinks("oops [[]] and [[unclosed", ofNs)).toEqual([]);
  });
  it("ignores triple-bracket (escape) form", () => {
    expect(parseWikilinks("literal [[[notwiki]]]", ofNs)).toEqual([]);
  });
  it("ignores code blocks and inline code", () => {
    const md =
      "before ```\n[[ignored]]\n``` after [[real]] also `[[inline]]`";
    expect(parseWikilinks(md, ofNs)).toEqual([
      { namespace: ofNs, key: "real" },
    ]);
  });
});
