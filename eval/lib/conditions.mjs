// eval/lib/conditions.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const VERBS = ["write", "read", "search", "browse", "link", "backlinks", "delete"];

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../conditions.json"), "utf-8"),
);

// Expand the compact {noun, framing} spec into a full per-condition surface:
// name = `${noun}_${verb}`, description = framings[framing][verb], result strings
// follow the framing. Crossed conditions (MxC/CxM) take noun from one framing and
// descriptions from another — that's the whole point, so we resolve them explicitly.
export function loadConditions() {
  const out = {};
  for (const id of ["M", "C", "K", "N", "MxC", "CxM"]) {
    const { noun, framing } = raw[id];
    const desc = raw.framings[framing];
    const tools = {};
    for (const verb of VERBS) {
      tools[verb] = { name: `${noun}_${verb}`, description: desc[verb] };
    }
    out[id] = {
      id, noun, framing, tools,
      resultStrings: raw.resultStrings[framing] ?? raw.resultStrings.neutral,
    };
  }
  return out;
}
