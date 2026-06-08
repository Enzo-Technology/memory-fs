// eval/lib/openai-adapter.mjs — Anthropic-shaped client backed by the OpenAI chat completions API.
// Translate Anthropic request/response shapes so runAgentLoop can use either provider.

function toOpenAIMessages(system, messages) {
  const result = [];
  if (system) result.push({ role: "system", content: system });
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }
    // Array content — may be tool_use (assistant) or tool_result (user).
    if (msg.role === "assistant") {
      // Extract text block (if any) and tool_use blocks.
      const textBlock = msg.content.find((b) => b.type === "text");
      const toolBlocks = msg.content.filter((b) => b.type === "tool_use");
      result.push({
        role: "assistant",
        content: textBlock ? textBlock.text : null,
        ...(toolBlocks.length ? {
          tool_calls: toolBlocks.map((b) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          })),
        } : {}),
      });
    } else if (msg.role === "user") {
      // tool_result blocks → one tool message per result.
      const toolResults = msg.content.filter((b) => b.type === "tool_result");
      for (const tr of toolResults) {
        const contentText = Array.isArray(tr.content)
          ? tr.content.map((c) => (typeof c === "string" ? c : c.text ?? JSON.stringify(c))).join("\n")
          : typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
        result.push({ role: "tool", tool_call_id: tr.tool_use_id, content: contentText });
      }
    }
  }
  return result;
}

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toAnthropicResponse(data) {
  const choice = data.choices[0];
  const msg = choice.message;
  const content = [];
  if (msg.content && msg.content.length > 0) {
    content.push({ type: "text", text: msg.content });
  }
  for (const tc of msg.tool_calls ?? []) {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* leave empty */ }
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  const fr = choice.finish_reason;
  const stop_reason = fr === "tool_calls" ? "tool_use" : fr === "length" ? "max_tokens" : "end_turn";
  return { content, stop_reason, usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 } };
}

export function makeOpenAIClient(modelId) {
  return {
    messages: {
      async create(req) {
        const body = {
          model: modelId,
          max_completion_tokens: req.max_tokens ?? 1024,
          temperature: req.temperature ?? 1.0,
          ...(req.reasoning_effort ? { reasoning_effort: req.reasoning_effort } : {}),
          messages: toOpenAIMessages(req.system, req.messages),
          ...(req.tools?.length ? {
            tools: toOpenAITools(req.tools),
            tool_choice: "auto",
          } : {}),
        };
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify(body),
          // Raw fetch has no built-in timeout (unlike the Anthropic SDK); a stalled
          // request would hang the whole run. Abort after 90s → iteration excluded.
          signal: AbortSignal.timeout(90000),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`OpenAI API error ${resp.status}: ${text}`);
        }
        const data = await resp.json();
        return toAnthropicResponse(data);
      },
    },
  };
}
