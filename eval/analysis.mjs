// eval/analysis.mjs — Wilson score interval + two-proportion risk difference.
export function wilson(x, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 0, n };
  const p = x / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n };
}

// Newcombe risk-difference CI from the two Wilson intervals.
export function riskDifference(a, b, z = 1.96) {
  const wa = wilson(a.x, a.n, z), wb = wilson(b.x, b.n, z);
  const diff = wa.p - wb.p;
  const lo = diff - Math.sqrt((wa.p - wa.lo) ** 2 + (wb.hi - wb.p) ** 2);
  const hi = diff + Math.sqrt((wa.hi - wa.p) ** 2 + (wb.p - wb.lo) ** 2);
  return { diff, lo, hi };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const scores = JSON.parse(readFileSync(resolve(import.meta.dirname, "artifacts/scores.json"), "utf-8"));
  const cell = (cond, model, metric, turn) => {
    const rows = scores.filter((r) => r.condition === cond && r.model === model && r.turn === turn && r[metric] !== undefined && r[metric] !== null);
    const x = rows.filter((r) => r[metric] === 1).length;
    return { x, n: rows.length };
  };
  const fmtRD = (rd) => `${(rd.diff*100).toFixed(0)}pp [${(rd.lo*100).toFixed(0)}, ${(rd.hi*100).toFixed(0)}]`;
  // Preregistered primary pairs (spec §8): H1 (M vs C on m4/T4), H2 (M vs C on m1/T1).
  // Reported separately per model.
  const models = ["claude", "openai"];
  const lines = [
    "# RESULTS — tool-wording experiment",
    "",
    "> Risk differences are the headline; p-values are descriptive (spec §8). " +
    "Null here means 'no large effect detected', NOT equivalence.",
    "",
    "## Preregistered primary (by model)",
  ];
  const gaps = {};
  for (const m of models) {
    const h1 = riskDifference(cell("M", m, "m4", "T4"), cell("C", m, "m4", "T4"));
    const h2 = riskDifference(cell("M", m, "m1", "T1"), cell("C", m, "m1", "T1"));
    gaps[m] = { h1: h1.diff, h2: h2.diff };
    lines.push(`### ${m}`);
    lines.push(`- **H1** (memory stores trivia more than context, m4/T4): RD = ${fmtRD(h1)}. Predicted ≥ 20pp.`);
    lines.push(`- **H2** (context reads more at cold start, m1/T1): RD = ${fmtRD(h2)}.`);
    lines.push("");
  }
  lines.push("## Provider comparison");
  lines.push(`- H1 M-vs-C gap: claude ${(gaps.claude.h1*100).toFixed(0)}pp vs openai ${(gaps.openai.h1*100).toFixed(0)}pp`);
  lines.push(`- H2 M-vs-C gap: claude ${(gaps.claude.h2*100).toFixed(0)}pp vs openai ${(gaps.openai.h2*100).toFixed(0)}pp`);
  lines.push("");
  lines.push("## Per-cell rates");
  lines.push("_(extend: loop conditions × metrics, print wilson() for each)_");
  const md = lines.join("\n");
  writeFileSync(resolve(import.meta.dirname, "../RESULTS.md"), md);
  console.log("wrote RESULTS.md");
}
