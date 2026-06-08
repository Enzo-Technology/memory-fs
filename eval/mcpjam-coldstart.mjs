// eval/mcpjam-coldstart.mjs — independent cross-check of the m1 metric using the
// @mcpjam/sdk agent runner (the runner the team trusts) instead of our own
// agent-loop.mjs. Cold-start ONLY: a single user turn, NO injected history —
// which is exactly what the T1 probe needs.
//
// Verified @mcpjam/sdk v1.12.0 API (file:line evidence in the agent report):
//   - new MCPClientManager({ [serverId]: <StdioServerConfig> })  // lazy connect
//       StdioServerConfig: { command, args, env }  (types-BJY6bi4K.d.ts:229)
//   - new Host({ style, model, systemPrompt, servers:[serverId] })  (index-B5O2YzC_.d.ts:511, public-types:253)
//       model string format: "anthropic/<id>" | "openai/<id>"  (model-factory.js:90/97)
//   - host.withManager(manager, { apiKey, maxSteps }) -> HostRuntime  (index-B5O2YzC_.d.ts:655)
//   - runtime.run(prompt, { stopWhen: stepCountIs(6) }) -> PromptResult  (index-B5O2YzC_.d.ts:487, PromptOptions:323)
//       result.getToolCalls() -> { toolName, arguments }[]  (index-B5O2YzC_.d.ts:218,58)
//       result.text                                         (index-B5O2YzC_.d.ts:116)
//   - manager.disconnectAllServers()  (index-B5O2YzC_.d.ts:1385)
//
// Telemetry: posthog.capture() fires ONLY inside EvalTest.run() (index.js:18466),
// which we never call. The Host/HostRuntime/MCPClientManager path is purely local.
// We additionally set DO_NOT_TRACK/MCPJAM_TELEMETRY_DISABLED to no-op the client
// (index.js:17272) as belt-and-suspenders.
process.env.DO_NOT_TRACK ??= "1";
process.env.MCPJAM_TELEMETRY_DISABLED ??= "1";

import { MCPClientManager, Host, stepCountIs } from "@mcpjam/sdk";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildSeedDb } from "./fixtures/seed-db.mjs";
import { scoreTurn } from "./wording-score.mjs";

// @mcpjam/sdk doesn't export ./package.json, so read it off disk for provenance.
const SDK_VERSION = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../node_modules/@mcpjam/sdk/package.json"), "utf-8"),
).version;

// Copied verbatim from eval/wording-run.mjs line 13-14 (NEUTRAL_SP). Inlined
// because wording-run.mjs guards main() and does not export this constant.
const NEUTRAL_SP =
  "You are an engineering assistant working with the Acme team. You have access to tools. Help the user with their requests.";

const WRAPPER = resolve(import.meta.dirname, "server/index.mjs");
const ARTIFACTS = resolve(import.meta.dirname, "artifacts-mcpjam");
const T1_PROMPT = "Draft a one-line headline for the Acme landing page.";
const SERVER_ID = "memory";
const MAX_STEPS = 6;

// model strings in @mcpjam/sdk's "provider/model" format (model-factory.js:90/97).
const MODELS = {
  sonnet: { llm: "anthropic/claude-sonnet-4-6", apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { llm: "openai/gpt-5.5", apiKeyEnv: "OPENAI_API_KEY" },
};

let MATRIX = {
  conditions: ["M", "C", "K", "MxC", "CxM"],
  models: ["sonnet", "openai"],
  n: 5,
};

// Same override style as wording-run.mjs's applyOverrides.
function applyOverrides(matrix, argv) {
  const val = (k) => { const a = argv.find((x) => x.startsWith(k + "=")); return a ? a.split("=")[1] : null; };
  const out = { ...matrix };
  const c = val("--conditions"); if (c) out.conditions = c.split(",");
  const m = val("--models"); if (m) out.models = m.split(",");
  const n = val("--n"); if (n) out.n = Number.parseInt(n, 10);
  return out;
}
MATRIX = applyOverrides(MATRIX, process.argv);
const PRINT = process.argv.includes("--print");

function makeManager(condition, dbPath) {
  // StdioServerConfig keyed by server id (types-BJY6bi4K.d.ts:229,322). Manager
  // connects lazily on first tool resolution; no explicit connect() needed.
  return new MCPClientManager({
    [SERVER_ID]: {
      command: "node",
      args: [WRAPPER],
      env: { ...process.env, MEMORY_FS_DB: dbPath, NAMING: condition },
    },
  });
}

// Connect + list tool NAMES only — no model call, no cost. Used by --selftest.
async function selftest(condition) {
  const dbPath = `/tmp/memfs-mcpjam-${randomUUID()}.db`;
  buildSeedDb(dbPath);
  const manager = makeManager(condition, dbPath);
  try {
    const tools = await manager.getToolsForAiSdk(SERVER_ID);
    console.log(`[selftest] condition=${condition} sdk=${SDK_VERSION} tools: ${Object.keys(tools).join(", ")}`);
  } finally {
    await manager.disconnectAllServers();
  }
}

async function runCell(condition, modelKey) {
  const { llm, apiKeyEnv } = MODELS[modelKey];
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`missing ${apiKeyEnv}`);

  const dbPath = `/tmp/memfs-mcpjam-${randomUUID()}.db`;
  buildSeedDb(dbPath);
  const manager = makeManager(condition, dbPath);
  try {
    const host = new Host({
      style: "mcpjam",
      model: llm,
      systemPrompt: NEUTRAL_SP,
      servers: [SERVER_ID],
    });
    const runtime = host.withManager(manager, { apiKey, maxSteps: MAX_STEPS });
    // stepCountIs guards the agentic loop; tools may run across steps then answer.
    const result = await runtime.run(T1_PROMPT, { stopWhen: stepCountIs(MAX_STEPS) });
    if (result.hasError?.()) throw new Error(result.getError() ?? "mcpjam run error");

    // Map PromptResult -> our scorer's T1 transcript shape.
    const toolCalls = result.getToolCalls().map((c) => ({ name: c.toolName, input: c.arguments }));
    const finalText = result.text ?? "";
    return {
      turn: "T1",
      toolCalls,
      finalText,
      readBeforeAnswer: toolCalls.length > 0,
    };
  } finally {
    await manager.disconnectAllServers();
  }
}

async function main() {
  if (process.argv.includes("--selftest")) {
    for (const condition of MATRIX.conditions) await selftest(condition);
    console.log("[selftest] ok");
    return;
  }

  const tally = []; // { condition, model, sum, total }
  for (const condition of MATRIX.conditions)
    for (const modelKey of MATRIX.models) {
      let sum = 0, total = 0;
      for (let iter = 0; iter < MATRIX.n; iter++) {
        let transcript;
        try { transcript = await runCell(condition, modelKey); }
        catch (e) { console.error(`\n[excluded] ${condition}/${modelKey}#${iter}: ${e.message}`); continue; }

        const m1 = scoreTurn(transcript).m1;
        sum += m1; total += 1;

        const dir = resolve(ARTIFACTS, condition, modelKey, "T1");
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${iter}.json`),
          JSON.stringify({
            runner: "mcpjam", sdkVersion: SDK_VERSION,
            condition, model: modelKey, turn: "T1", iter,
            m1, transcript,
          }, null, 2));
        process.stdout.write(".");
        if (PRINT) {
          console.log(`\n[${condition}/${modelKey}#${iter}] m1=${m1}`);
          for (const c of transcript.toolCalls) console.log(`  → ${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
          console.log(`  answer: ${transcript.finalText.slice(0, 200)}`);
        }
      }
      tally.push({ condition, model: modelKey, sum, total });
    }

  console.log("\n\n=== m1 (read-before-answer) — runner: mcpjam ===");
  for (const r of tally) console.log(`${r.condition}/${r.model} ${r.sum}/${r.total}`);
  process.stdout.write("done\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
