// eval/lib/agent-loop.mjs — minimal multi-step tool loop over the Anthropic SDK.
// Records ordered tool calls and whether any tool ran before the first assistant text.
export async function runAgentLoop({ anthropic, mcp, model, system, tools, messages, maxSteps = 10, temperature = 1.0, maxTokens = 1024, extraCreateArgs = {} }) {
  const convo = messages.slice();
  const toolCalls = [];
  let readBeforeAnswer = false;
  let sawText = false;
  let finalText = "";
  let usageIn = 0, usageOut = 0; // accumulate across steps for budget tracking

  for (let step = 0; step < maxSteps; step++) {
    const res = await anthropic.messages.create({
      model, max_tokens: maxTokens, system, tools, messages: convo,
      ...(temperature != null ? { temperature } : {}), // omitted when thinking is on (avoids 400)
      ...extraCreateArgs, // provider-specific: anthropic thinking/effort, openai reasoning_effort
    });
    if (res.usage) { usageIn += res.usage.input_tokens ?? 0; usageOut += res.usage.output_tokens ?? 0; }
    const textBlocks = res.content.filter((b) => b.type === "text");
    const toolBlocks = res.content.filter((b) => b.type === "tool_use");

    if (textBlocks.length) { sawText = true; finalText = textBlocks.map((b) => b.text).join("\n"); }
    for (const b of toolBlocks) {
      if (!sawText && toolCalls.length === 0) readBeforeAnswer = true; // first action was a tool call
      toolCalls.push({ name: b.name, input: b.input });
    }

    if (res.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      return { toolCalls, readBeforeAnswer, finalText, steps: step + 1, stopReason: res.stop_reason, usage: { input: usageIn, output: usageOut } };
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
  return { toolCalls, readBeforeAnswer, finalText, steps: maxSteps, stopReason: "max_steps", usage: { input: usageIn, output: usageOut } };
}
