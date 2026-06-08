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
  openai: { provider: "openai", id: "gpt-5.5" },
};

function resolveClient(modelKey) {
  const { provider, id } = MODELS[modelKey];
  if (provider === "openai") return { client: makeOpenAIClient(id), id, provider };
  return { client: new Anthropic(), id, provider };
}

// Provider-specific create() config: both reason at LOW effort (cost trim + matched depth).
// anthropic → adaptive thinking + effort:low, temperature omitted (avoids thinking+temp 400).
// openai (reasoning model) → reasoning_effort:low.
function createConfigFor(provider) {
  return provider === "openai"
    ? { extraCreateArgs: {}, temperature: 1.0, maxTokens: 4096 }
    : { extraCreateArgs: { thinking: { type: "adaptive" }, output_config: { effort: "low" } }, temperature: null, maxTokens: 4096 };
}

// --pilot: M+C × sonnet (Claude) × P1,P2,P3b × n=5 — the initial Claude baseline.
// --pilot-openai: same matrix but the OpenAI model — run separately so the two providers
//   write into the same archive (model=sonnet vs model=openai) for a paired comparison.
// --full: the §3 concentrated grid.
const PILOT_OPENAI = process.argv.includes("--pilot-openai");
const PILOT = process.argv.includes("--pilot");
let MATRIX = PILOT_OPENAI
  ? { conditions: ["M", "C"], models: ["openai"], scripts: ["P1", "P2", "P3b"], n: 5 }
  : PILOT
  ? { conditions: ["M", "C"], models: ["sonnet"], scripts: ["P1", "P2", "P3b"], n: 5 }
  : { conditions: ["M", "C", "K", "N", "MxC", "CxM", "PROD"], models: ["haiku", "sonnet", "opus"], scripts: ["P1", "P2", "P3b"], n: 20 };

// Matrix overrides from argv, e.g. --conditions=M,C --models=sonnet --scripts=P1 --n=1
// Exported so it can be unit-tested without executing the experiment (see run-overrides.test.ts).
export function applyOverrides(matrix, argv) {
  const val = (k) => { const a = argv.find((x) => x.startsWith(k + "=")); return a ? a.split("=")[1] : null; };
  const out = { ...matrix };
  const c = val("--conditions"); if (c) out.conditions = c.split(",");
  const s = val("--scripts"); if (s) out.scripts = s.split(",");
  const m = val("--models"); if (m) out.models = m.split(",");
  const n = val("--n"); if (n) out.n = Number.parseInt(n, 10);
  return out;
}
MATRIX = applyOverrides(MATRIX, process.argv);
const TERSE = process.argv.includes("--terse");
const PRINT = process.argv.includes("--print"); // dump each cell's trace to stdout (1-off eyeballing)

function shuffleLogged(tools) {
  const order = tools.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { tools: order.map((i) => tools[i]), order };
}

async function connectServer(condition, dbPath, terse = false) {
  const isProd = condition === "PROD";
  const client = new Client({ name: "wording-run", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [isProd ? REAL_SERVER : WRAPPER],
    env: { ...process.env, MEMORY_FS_DB: dbPath, ...(isProd ? {} : { NAMING: condition }), ...(terse ? { TERSE: "1" } : {}) },
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

async function runScript({ anthropic, modelId, condition, model, modelLabel, scriptId, iter, createConfig, terse }) {
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
      const { client, tools } = await connectServer(condition, dbPath, terse);
      const { tools: shuffled, order } = shuffleLogged(tools);
      shared = { client, tools: shuffled, order, dbPath, messages: baseHistory.slice() };
    }
    shared.messages.push({ role: "user", content: turn.text });
    const r = await runAgentLoop({ anthropic, mcp: shared.client, model: modelId,
      system: NEUTRAL_SP, tools: shared.tools, messages: shared.messages, maxSteps: 6, ...createConfig });
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
          const { client: anthropic, id: modelId, provider } = resolveClient(model);
          const createConfig = createConfigFor(provider);
          const modelLabel = TERSE ? `${model}-terse` : model;
          let transcripts;
          try { transcripts = await runScript({ anthropic, modelId, condition, model, modelLabel, scriptId, iter, createConfig, terse: TERSE }); }
          catch (e) { console.error(`\n[excluded] ${condition}/${modelLabel}/${scriptId}#${iter}: ${e.message}`); continue; }
          const dir = resolve(ARTIFACTS, condition, modelLabel, scriptId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${iter}.json`),
            JSON.stringify({ condition, model: modelLabel, scriptId, iter, transcripts }, null, 2));
          process.stdout.write(".");
          if (PRINT) {
            for (const t of transcripts) {
              console.log(`\n[${condition}/${modelLabel}/${scriptId}#${iter}] ${t.turn}`);
              for (const c of (t.toolCalls ?? [])) console.log(`  → ${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
              console.log(`  answer: ${(t.finalText ?? "").slice(0, 200)}`);
            }
          }
        }
  process.stdout.write("\ndone\n");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
