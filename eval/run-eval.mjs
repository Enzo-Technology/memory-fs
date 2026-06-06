#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const SERVER_PATH = resolve(import.meta.dirname, "../dist/index.js");
const VARIANTS = ["A-minimal", "B-usage-hints", "C-meta-instruction"];
const REGIMES = ["clean", "mixed"];
const RUNS_PER_PROMPT = 5;
const MODEL = "claude-haiku-4-5";

const prompts = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "prompts.json"), "utf-8"),
);

function loadSystemPrompt(variant) {
  return readFileSync(
    resolve(import.meta.dirname, `system-prompts/${variant}.md`),
    "utf-8",
  );
}

async function discoverMemoryTools() {
  const client = new Client({ name: "eval-runner", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: [SERVER_PATH],
      env: { ...process.env, MEMORY_FS_DB: `/tmp/memfs-eval-${randomUUID()}.db` },
    }),
  );
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function runCell(client, system, tools, userPrompt) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 1.0,
    system,
    tools: shuffle(tools),
    messages: [{ role: "user", content: userPrompt }],
  });
  const calls = res.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name, input: b.input }));
  return { calls, stop_reason: res.stop_reason };
}

async function main() {
  const memoryTools = await discoverMemoryTools();
  const distractorTools = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "distractor-tools.json"), "utf-8"),
  );
  const anthropic = new Anthropic();

  const outDir = resolve(import.meta.dirname, "results");
  mkdirSync(outDir, { recursive: true });

  for (const regime of REGIMES) {
    const tools = regime === "clean" ? memoryTools : [...memoryTools, ...distractorTools];
    for (const variant of VARIANTS) {
      const system = loadSystemPrompt(variant);
      for (const [category, spec] of Object.entries(prompts.categories)) {
        for (const [idx, userPrompt] of spec.prompts.entries()) {
          for (let run = 0; run < RUNS_PER_PROMPT; run++) {
            const result = await runCell(anthropic, system, tools, userPrompt);
            const traceFile = `${regime}-${variant}-${category}-${idx}-run${run}.json`;
            writeFileSync(
              resolve(outDir, traceFile),
              JSON.stringify(
                { regime, variant, category, idx, run, userPrompt, ...result },
                null,
                2,
              ),
            );
            process.stdout.write(".");
          }
        }
      }
      process.stdout.write(`\n${regime}/${variant} done\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
