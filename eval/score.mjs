#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "results");
const traces = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "SUMMARY.json")
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));

const EXPECT_MEMORY_TOOL = {
  explicit_invocation: "memory_note",
  implicit_recall: "memory_recall",
  implicit_write: "memory_note",
  multi_step: "memory_recall",
};

const stats = {};
for (const t of traces) {
  const k = `${t.regime}/${t.variant}`;
  stats[k] ??= { total: 0, hit: 0, fp: 0, fpDenom: 0 };
  stats[k].total++;
  const calledMemory = t.calls.some((c) => c.name.startsWith("memory_"));
  if (t.category === "distractor") {
    stats[k].fpDenom++;
    if (calledMemory) stats[k].fp++;
  } else {
    const expected = EXPECT_MEMORY_TOOL[t.category];
    const correct = t.calls.some((c) => c.name === expected);
    if (correct) stats[k].hit++;
  }
}

console.log("Cell\t\t\thits/total\tfp/distractors");
for (const [k, s] of Object.entries(stats)) {
  const hitRate = (s.hit / (s.total - s.fpDenom)) * 100;
  const fpRate = (s.fp / s.fpDenom) * 100;
  console.log(
    `${k.padEnd(28)}${s.hit}/${s.total - s.fpDenom} (${hitRate.toFixed(1)}%)\t${s.fp}/${s.fpDenom} (${fpRate.toFixed(1)}%)`,
  );
}
