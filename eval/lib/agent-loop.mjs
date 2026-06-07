// eval/lib/agent-loop.mjs — minimal multi-step tool loop over the Anthropic SDK.
// Records ordered tool calls and whether any tool ran before the first assistant text.
export async function runAgentLoop({ anthropic, mcp, model, system, tools, messages, maxSteps = 10, temperature = 1.0 }) {
  const convo = messages.slice();
  const toolCalls = [];
  let readBeforeAnswer = false;
  let sawText = false;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    const res = await anthropic.messages.create({
      model, max_tokens: 1024, temperature, system, tools, messages: convo,
    });
    const textBlocks = res.content.filter((b) => b.type === "text");
    const toolBlocks = res.content.filter((b) => b.type === "tool_use");

    if (textBlocks.length) { sawText = true; finalText = textBlocks.map((b) => b.text).join("\n"); }
    for (const b of toolBlocks) {
      if (!sawText && toolCalls.length === 0) readBeforeAnswer = true; // first action was a tool call
      toolCalls.push({ name: b.name, input: b.input });
    }

    if (res.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      return { toolCalls, readBeforeAnswer, finalText, steps: step + 1, stopReason: res.stop_reason };
    }

    convo.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of toolBlocks) {
      let out;
      try { out = await mcp.callTool({ name: b.name, arguments: b.input }); }
      catch (e) { out = { content: [{ type: "text", text: `error: ${e.message}` }], isError: true }; }
      results.push({ type: "tool_result", tool_use_id: b.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    }
    convo.push({ role: "user", content: results });
  }
  return { toolCalls, readBeforeAnswer, finalText, steps: maxSteps, stopReason: "max_steps" };
}
