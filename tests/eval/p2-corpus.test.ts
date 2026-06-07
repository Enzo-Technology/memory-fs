import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "../../eval/fixtures/p2-corpus");

const BANNED_WORDS = /(memory|context|knowledge)/i;
const BANNED_TOOLS = /_(write|read|search|browse|link|backlinks|delete)\b/i;

type Message = { role: string; content: string };

describe("p2-corpus fixtures", () => {
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  it("has at least 6 corpus files", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    describe(file, () => {
      let messages: Message[];

      it("parses as valid JSON array", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        expect(Array.isArray(messages)).toBe(true);
      });

      it("has 8–14 turns", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        expect(messages.length).toBeGreaterThanOrEqual(8);
        expect(messages.length).toBeLessThanOrEqual(14);
      });

      it("each message has role∈{user,assistant} and string content", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        for (const msg of messages) {
          expect(["user", "assistant"]).toContain(msg.role);
          expect(typeof msg.content).toBe("string");
          expect(msg.content.length).toBeGreaterThan(0);
        }
      });

      it("contains no banned words (memory|context|knowledge)", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        for (const msg of messages) {
          const match = msg.content.match(BANNED_WORDS);
          expect(
            match,
            `Found banned word "${match?.[0]}" in ${file} (${msg.role}): ...${msg.content.slice(Math.max(0, msg.content.search(BANNED_WORDS) - 20), msg.content.search(BANNED_WORDS) + 40)}...`
          ).toBeNull();
        }
      });

      it("contains no banned tool-name fragments", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        for (const msg of messages) {
          const match = msg.content.match(BANNED_TOOLS);
          expect(
            match,
            `Found banned tool fragment "${match?.[0]}" in ${file}`
          ).toBeNull();
        }
      });

      it("contains no tool-block objects (tool_use/tool_result/function_call)", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        for (const msg of messages) {
          expect(typeof msg.content).toBe("string");
          // content must be a plain string, not a nested object/array
          expect(Array.isArray(msg.content)).toBe(false);
          const toolPattern = /tool_use|tool_result|function_call/i;
          expect(toolPattern.test(msg.content)).toBe(false);
        }
      });

      it("alternates user/assistant starting with user", () => {
        const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf-8");
        messages = JSON.parse(raw) as Message[];
        for (let i = 0; i < messages.length; i++) {
          const expectedRole = i % 2 === 0 ? "user" : "assistant";
          expect(messages[i].role).toBe(expectedRole);
        }
      });
    });
  }
});
