import { describe, expect, it } from "vitest";
import { tokenize, type Token } from "../ui/src/wikilinkText.js";

describe("tokenize", () => {
  const ns = "project:enzo";

  it("returns a single text token for plain content", () => {
    expect(tokenize("just prose, no links", ns)).toEqual<Token[]>([
      { kind: "text", text: "just prose, no links" },
    ]);
  });

  it("splits a single link out of surrounding text, preserving it exactly", () => {
    expect(tokenize("see [[auth-decision]] now", ns)).toEqual<Token[]>([
      { kind: "text", text: "see " },
      { kind: "link", raw: "auth-decision", namespace: ns, key: "auth-decision" },
      { kind: "text", text: " now" },
    ]);
  });

  it("resolves the ns:key form", () => {
    expect(tokenize("[[voice:errors/tone]]", ns)).toEqual<Token[]>([
      { kind: "link", raw: "voice:errors/tone", namespace: "voice:errors", key: "tone" },
    ]);
  });

  it("uses the default namespace for a bare key, normalizing it to the stored slug", () => {
    // No colon → default namespace; the slash is slugged to a dash, matching how the server
    // stores the link target (normalizeKey("notes/a") === "notes-a").
    expect(tokenize("[[notes/a]]", ns)).toEqual<Token[]>([
      { kind: "link", raw: "notes/a", namespace: ns, key: "notes-a" },
    ]);
  });

  it("normalizes the parsed address to the canonical stored form (raw preserved for display)", () => {
    expect(tokenize("[[Project:Web Stuff/Auth Decision]]", ns)).toEqual<Token[]>([
      {
        kind: "link",
        raw: "Project:Web Stuff/Auth Decision",
        namespace: "project:web-stuff",
        key: "auth-decision",
      },
    ]);
  });

  it("leaves a [[link]] inside a fenced code block as text", () => {
    const md = "before ```\n[[ignored]]\n``` after [[real]]";
    expect(tokenize(md, ns)).toEqual<Token[]>([
      { kind: "text", text: "before ```\n[[ignored]]\n``` after " },
      { kind: "link", raw: "real", namespace: ns, key: "real" },
    ]);
  });

  it("leaves a [[link]] inside inline code as text", () => {
    expect(tokenize("`[[inline]]` and [[real]]", ns)).toEqual<Token[]>([
      { kind: "text", text: "`[[inline]]` and " },
      { kind: "link", raw: "real", namespace: ns, key: "real" },
    ]);
  });

  it("leaves a [[[triple]]] escape form as text", () => {
    expect(tokenize("literal [[[notwiki]]] here", ns)).toEqual<Token[]>([
      { kind: "text", text: "literal [[[notwiki]]] here" },
    ]);
  });

  it("emits every occurrence of the same link (no dedup, unlike the server)", () => {
    expect(tokenize("[[x]] [[x]]", ns)).toEqual<Token[]>([
      { kind: "link", raw: "x", namespace: ns, key: "x" },
      { kind: "text", text: " " },
      { kind: "link", raw: "x", namespace: ns, key: "x" },
    ]);
  });
});
