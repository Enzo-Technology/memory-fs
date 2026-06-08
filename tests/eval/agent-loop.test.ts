// tests/eval/agent-loop.test.ts
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../../eval/lib/agent-loop.mjs";

// Fake Anthropic: first response calls a tool, second responds with text.
function fakeAnthropic(script: any[]) {
  let i = 0;
  return { messages: { create: async () => script[i++] } };
}
const toolUse = (name: string, input: any) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu_1", name, input }],
});
const textMsg = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const fakeMcp = { callTool: async () => ({ content: [{ type: "text", text: "result" }] }) };

describe("agent loop", () => {
  it("executes tool calls and continues to a final text answer", async () => {
    const anthropic = fakeAnthropic([toolUse("context_search", { query: "auth" }), textMsg("done")]);
    const r = await runAgentLoop({ anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.toolCalls.map((c) => c.name)).toEqual(["context_search"]);
    expect(r.readBeforeAnswer).toBe(true);  // tool call came before any assistant text
    expect(r.finalText).toBe("done");
  });

  it("flags readBeforeAnswer=false when the model answers without any tool call", async () => {
    const anthropic = fakeAnthropic([textMsg("here you go")]);
    const r = await runAgentLoop({ anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [], messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.toolCalls).toEqual([]);
    expect(r.readBeforeAnswer).toBe(false);
  });

  it("readBeforeAnswer=true when first response has both text and tool_use blocks (provider-neutral)", async () => {
    // Realistic case: Claude emits a preamble then a tool call in the same response.
    // readBeforeAnswer = any tool ran before the final answer, regardless of block order.
    const mixedFirst = {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me look that up." },
        { type: "tool_use", id: "tu_2", name: "context_search", input: { query: "auth" } },
      ],
    };
    const anthropic = fakeAnthropic([mixedFirst, textMsg("found it")]);
    const r = await runAgentLoop({ anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.readBeforeAnswer).toBe(true);  // tool ran before the final answer; preamble text in same message is irrelevant
    expect(r.toolCalls.map((c) => c.name)).toEqual(["context_search"]);
    expect(r.finalText).toBe("found it");
  });

  it("tool error: loop continues and produces a final answer, tool call is recorded", async () => {
    const failingMcp = { callTool: async () => { throw new Error("network timeout"); } };
    const anthropic = fakeAnthropic([toolUse("context_search", { query: "x" }), textMsg("recovered")]);
    const r = await runAgentLoop({ anthropic, mcp: failingMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 10 });
    expect(r.toolCalls.map((c) => c.name)).toEqual(["context_search"]);
    expect(r.finalText).toBe("recovered");
    expect(r.stopReason).toBe("end_turn");
  });

  it("counts a tool call as read-before-answer even when the model narrates in the same message (regression)", async () => {
    // Anthropic emits a text preamble in the SAME assistant message as its first tool_use.
    const preambleThenTool = {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me check the store first." },
        { type: "tool_use", id: "tu_1", name: "context_search", input: { query: "x" } },
      ],
    };
    const anthropic = fakeAnthropic([preambleThenTool, textMsg("done")]);
    const r = await runAgentLoop({
      anthropic, mcp: fakeMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 10,
    });
    expect(r.toolCalls.map((c) => c.name)).toEqual(["context_search"]);
    expect(r.readBeforeAnswer).toBe(true); // BUG WAS false: preamble text flipped the flag
  });

  it("stopReason=max_steps and exactly maxSteps tool calls when model always returns tool_use", async () => {
    // Anthropic always returns a tool_use — loop must terminate at maxSteps.
    const infinite = { messages: { create: async () => toolUse("context_search", { query: "q" }) } };
    const r = await runAgentLoop({ anthropic: infinite, mcp: fakeMcp, model: "m", system: "s",
      tools: [{ name: "context_search", description: "d", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }], maxSteps: 3 });
    expect(r.stopReason).toBe("max_steps");
    expect(r.toolCalls).toHaveLength(3);
  });
});
