// eval/wording-run.mjs — run the wording experiment matrix, archive every transcript.
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAgentLoop } from "./lib/agent-loop.mjs";
import { buildSeedDb } from "./fixtures/seed-db.mjs";
import { SCRIPTS } from "./scripts.mjs";
import { makeOpenAIClient } from "./lib/openai-adapter.mjs";

const NEUTRAL_SP =
  "You are an engineering assistant working with the Acme team. You have access to tools. Help the user with their requests.";
const WRAPPER = resolve(import.meta.dirname, "server/index.mjs");
const REAL_SERVER = resolve(import.meta.dirname, "../dist/index.js");
const ARTIFACTS = resolve(import.meta.dirname, "artifacts");

// VERIFY these IDs against the API before a full run (spec §3, /claude-api).
const MODELS = {
  haiku: { provider: "anthropic", id: "claude-haiku-4-5-20251001" },
  sonnet: { provider: "anthropic", id: "claude-sonnet-4-6" },
  opus: { provider: "anthropic", id: "claude-opus-4-8" },
  claude: { provider: "anthropic", id: "claude-sonnet-4-6" },
  openai: { provider: "openai", id: "gpt-4.1" },
};

function resolveClient(modelKey) {
  const { provider, id } = MODELS[modelKey];
  if (provider === "openai") return { client: makeOpenAIClient(id), id };
  return { client: new Anthropic(), id };
}

// --pilot: M+C × claude+openai × P1,P2 × n=5. --full: the §3 concentrated grid (fill in after pilot).
const PILOT = process.argv.includes("--pilot");
const MATRIX = PILOT
  ? { conditions: ["M", "C"], models: ["claude", "openai"], scripts: ["P1", "P2"], n: 5 }
  : { conditions: ["M", "C", "K", "N", "MxC", "CxM", "PROD"], models: ["haiku", "sonnet", "opus"], scripts: ["P1", "P2", "P3b"], n: 20 };

function shuffleLogged(tools) {
  const order = tools.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { tools: order.map((i) => tools[i]), order };
}

async function connectServer(condition, dbPath) {
  const isProd = condition === "PROD";
  const client = new Client({ name: "wording-run", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [isProd ? REAL_SERVER : WRAPPER],
    env: { ...process.env, MEMORY_FS_DB: dbPath, ...(isProd ? {} : { NAMING: condition }) },
  }));
  const { tools } = await client.listTools();
  return { client, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) };
}

// Resolve the base history for a script at a given iteration.
// Corpus scripts (P2): pick corpus[iter % corpus.length] — paired design: same chat for M and C at iter i.
// Non-corpus scripts: use script.history ?? [].
function resolveHistory(script, iter) {
  if (script.corpus) {
    const idx = iter % script.corpus.length;
    return { baseHistory: script.corpus[idx], historySource: `corpus[${idx}]` };
  }
  return { baseHistory: script.history ?? [], historySource: "history" };
}

async function runScript({ anthropic, modelId, condition, model, scriptId, iter }) {
  const script = SCRIPTS[scriptId];
  const { baseHistory, historySource } = resolveHistory(script, iter);
  const transcripts = [];
  // Probes flagged `fresh` get their own conversation + own seeded DB; the rest
  // share one conversation atop the fabricated history (spec §4).
  let shared = null;
  for (const turn of script.turns) {
    if (turn.fresh || !shared) {
      const dbPath = `/tmp/memfs-wording-${randomUUID()}.db`;
      buildSeedDb(dbPath);
      const { client, tools } = await connectServer(condition, dbPath);
      const { tools: shuffled, order } = shuffleLogged(tools);
      shared = { client, tools: shuffled, order, dbPath, messages: baseHistory.slice() };
    }
    shared.messages.push({ role: "user", content: turn.text });
    const r = await runAgentLoop({ anthropic, mcp: shared.client, model: modelId,
      system: NEUTRAL_SP, tools: shared.tools, messages: shared.messages, maxSteps: 10 });
    // Empty assistant content would cause the next turn's API call to reject.
    shared.messages.push({ role: "assistant", content: r.finalText?.trim() ? r.finalText : "(no further comment)" });
    transcripts.push({ turn: turn.id, toolOrder: shared.order, historySource, ...r });
    if (turn.fresh) { await shared.client.close(); shared = null; }
  }
  if (shared) await shared.client.close();
  return transcripts;
}

async function main() {
  for (const condition of MATRIX.conditions)
    for (const model of MATRIX.models)
      for (const scriptId of MATRIX.scripts)
        for (let iter = 0; iter < MATRIX.n; iter++) {
          const { client: anthropic, id: modelId } = resolveClient(model);
          let transcripts;
          try { transcripts = await runScript({ anthropic, modelId, condition, model, scriptId, iter }); }
          catch (e) { console.error(`\n[excluded] ${condition}/${model}/${scriptId}#${iter}: ${e.message}`); continue; }
          const dir = resolve(ARTIFACTS, condition, model, scriptId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${iter}.json`),
            JSON.stringify({ condition, model, scriptId, iter, transcripts }, null, 2));
          process.stdout.write(".");
        }
  process.stdout.write("\ndone\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
