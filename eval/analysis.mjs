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

  const scores = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "artifacts/scores.json"), "utf-8"),
  );

  // --- helpers ---

  // All (condition, model) pairs present in the data.
  const allConditions = [...new Set(scores.map((r) => r.condition))].sort();
  const allModels = [...new Set(scores.map((r) => r.model))].sort();
  const pairs = [];
  for (const cond of allConditions)
    for (const model of allModels)
      if (scores.some((r) => r.condition === cond && r.model === model))
        pairs.push({ cond, model });

  // Binary cell: { x, n } where n = rows for (cond, model, turn) that have metric defined.
  const cell = (cond, model, metric, turn) => {
    const rows = scores.filter(
      (r) =>
        r.condition === cond &&
        r.model === model &&
        r.turn === turn &&
        r[metric] !== undefined &&
        r[metric] !== null,
    );
    return { x: rows.filter((r) => r[metric] === 1).length, n: rows.length };
  };

  // True when both cells have n > 0.
  const hasBoth = (cA, cB, model, metric, turn) =>
    cell(cA, model, metric, turn).n > 0 && cell(cB, model, metric, turn).n > 0;

  // m3b 3-way count.
  const m3bCount = (cond, model) => {
    const rows = scores.filter(
      (r) =>
        r.condition === cond && r.model === model && r.turn === "T3" && r.m3b !== undefined,
    );
    return {
      update: rows.filter((r) => r.m3b === "update").length,
      duplicate: rows.filter((r) => r.m3b === "duplicate").length,
      none: rows.filter((r) => r.m3b === "none").length,
      total: rows.length,
    };
  };

  // Formatting helpers.
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  // fmtW accepts either a wilson result {p,lo,hi,n} or a cell {x,n}; if given {x,n} it calls wilson.
  const fmtW = (arg) => {
    const w = "p" in arg ? arg : wilson(arg.x, arg.n);
    return w.n === 0 ? "—" : `${pct(w.p)} [${pct(w.lo)}–${pct(w.hi)}] (n=${w.n})`;
  };
  const fmtRD = (rd) =>
    `${(rd.diff * 100).toFixed(0)}pp [${(rd.lo * 100).toFixed(0)}, ${(rd.hi * 100).toFixed(0)}]`;

  // --- build RESULTS.md ---

  const lines = [
    "# RESULTS — tool-wording experiment",
    "",
    "> **Interpretation note:** Risk differences are the headline; null here means",
    "> 'no large effect detected', NOT equivalence. Confidence intervals are Wilson",
    "> 95% CIs; risk-difference CIs use the Newcombe method.",
    "",
  ];

  // 1. Per-(condition × model) rate table for all binary metrics.
  const BINARY_METRICS = [
    { metric: "m1", turn: "T1", label: "m1 unprompted-read (T1)" },
    { metric: "m4", turn: "T4", label: "m4 trivia-write (T4)" },
    { metric: "m5", turn: "T5", label: "m5 deposit-rate (T5)" },
    { metric: "m6", turn: "P3b", label: "m6 spurious-write (P3b)" },
    { metric: "m7b", turn: "P3b", label: "m7b tidy-deploy-smoke (P3b)" },
    { metric: "m3a", turn: "T3", label: "m3a scoped-read (T3)" },
  ];

  lines.push("## Per-(condition × model) rate table");
  lines.push("");

  // Header row.
  const colHeaders = BINARY_METRICS.map((m) => m.label);
  lines.push(`| condition | model | ${colHeaders.join(" | ")} |`);
  lines.push(`| --- | --- | ${BINARY_METRICS.map(() => "---").join(" | ")} |`);

  for (const { cond, model } of pairs) {
    const cells = BINARY_METRICS.map(({ metric, turn }) => fmtW(cell(cond, model, metric, turn)));
    lines.push(`| ${cond} | ${model} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  // m3b 3-way table.
  lines.push("### m3b update-behaviour (T3)");
  lines.push("");
  lines.push("| condition | model | update | duplicate | none | n |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const { cond, model } of pairs) {
    const c = m3bCount(cond, model);
    if (c.total === 0) continue;
    lines.push(`| ${cond} | ${model} | ${c.update} | ${c.duplicate} | ${c.none} | ${c.total} |`);
  }
  lines.push("");

  // 2. Preregistered comparisons.
  lines.push("## Preregistered comparisons");
  lines.push("");

  // Models that have both M and C data.
  const modelsWithMC = allModels.filter(
    (m) =>
      scores.some((r) => r.condition === "M" && r.model === m) &&
      scores.some((r) => r.condition === "C" && r.model === m),
  );

  // Base models (strip -terse suffix).
  const baseModels = [...new Set(allModels.map((m) => m.replace(/-terse$/, "")))];
  const terseModels = allModels.filter((m) => m.endsWith("-terse"));
  const hasTerse = terseModels.length > 0;

  // H1 and H2 — per model.
  lines.push("### H1 — Memory stores trivia more than Context (m4/T4)");
  lines.push("> Predicted ≥ 20pp M > C.");
  lines.push("");
  for (const model of modelsWithMC) {
    if (!hasBoth("M", "C", model, "m4", "T4")) {
      lines.push(`- **${model}**: insufficient data`);
      continue;
    }
    const rd = riskDifference(cell("M", model, "m4", "T4"), cell("C", model, "m4", "T4"));
    lines.push(`- **${model}**: RD = ${fmtRD(rd)} (M minus C)`);
  }
  lines.push("");

  lines.push("### H2 — Context reads more at cold start (m1/T1)");
  lines.push("> Predicted ≥ 10pp C > M.");
  lines.push("");
  for (const model of modelsWithMC) {
    if (!hasBoth("C", "M", model, "m1", "T1")) {
      lines.push(`- **${model}**: insufficient data`);
      continue;
    }
    const rd = riskDifference(cell("C", model, "m1", "T1"), cell("M", model, "m1", "T1"));
    lines.push(`- **${model}**: RD = ${fmtRD(rd)} (C minus M)`);
  }
  lines.push("");

  // H3 — K vs C on m4/T4 (if K present).
  const modelsInK = allModels.filter((m) => scores.some((r) => r.condition === "K" && r.model === m));
  if (modelsInK.length > 0) {
    lines.push("### H3 — Keyword condition vs Context on trivia (m4/T4)");
    lines.push("");
    for (const model of modelsInK) {
      const hasKC = hasBoth("K", "C", model, "m4", "T4");
      if (hasKC) {
        const rd = riskDifference(cell("K", model, "m4", "T4"), cell("C", model, "m4", "T4"));
        const dep = cell("K", model, "m5", "T5");
        const depStr = dep.n > 0 ? `, K deposit rate m5/T5: ${fmtW(dep)}` : "";
        lines.push(`- **${model}**: RD = ${fmtRD(rd)} (K minus C)${depStr}`);
      } else {
        lines.push(`- **${model}**: insufficient data`);
      }
    }
    lines.push("");
  }

  // H4 — cross conditions (MxC, CxM) if present.
  const crossConditions = allConditions.filter((c) => c === "MxC" || c === "CxM");
  if (crossConditions.length > 0) {
    lines.push("### H4 — Noun×Description cross conditions");
    lines.push("> Verdict: |cross−C| < |cross−M| → behaves like C (description-driven); otherwise noun-driven.");
    lines.push("");
    for (const cross of crossConditions) {
      const crossModels = allModels.filter((m) =>
        scores.some((r) => r.condition === cross && r.model === m),
      );
      for (const model of crossModels) {
        for (const { metric, turn, label } of [
          { metric: "m4", turn: "T4", label: "trivia m4/T4" },
          { metric: "m1", turn: "T1", label: "cold-read m1/T1" },
        ]) {
          const cCross = cell(cross, model, metric, turn);
          const cM = cell("M", model, metric, turn);
          const cC = cell("C", model, metric, turn);
          if (cCross.n === 0) continue;
          const rdVsM = cM.n > 0 ? riskDifference(cCross, cM) : null;
          const rdVsC = cC.n > 0 ? riskDifference(cCross, cC) : null;
          const crossRate = pct(cCross.p);
          const mRate = cM.n > 0 ? pct(cM.p) : "—";
          const cRate = cC.n > 0 ? pct(cC.p) : "—";
          let verdict = "";
          if (rdVsM && rdVsC) {
            const distM = Math.abs(rdVsM.diff);
            const distC = Math.abs(rdVsC.diff);
            verdict =
              distC < distM
                ? " → behaves like C (description-driven)"
                : " → behaves like M (noun-driven)";
          }
          lines.push(
            `- **${cross}/${model}** ${label}: ${cross}=${crossRate}, M=${mRate}, C=${cRate}` +
              (rdVsM ? `; vs M: ${fmtRD(rdVsM)}` : "") +
              (rdVsC ? `; vs C: ${fmtRD(rdVsC)}` : "") +
              verdict,
          );
        }
      }
    }
    lines.push("");
  }

  // Terse vs full comparison.
  if (hasTerse) {
    lines.push("### Terse vs full wording");
    lines.push("> Does the framing gap grow when descriptions are compressed?");
    lines.push("");
    for (const base of baseModels) {
      const terse = `${base}-terse`;
      if (!allModels.includes(terse)) continue;
      const conditions = allConditions.filter(
        (c) =>
          scores.some((r) => r.condition === c && r.model === base) &&
          scores.some((r) => r.condition === c && r.model === terse),
      );
      for (const cond of conditions) {
        for (const { metric, turn, label } of [
          { metric: "m4", turn: "T4", label: "m4/T4" },
          { metric: "m1", turn: "T1", label: "m1/T1" },
        ]) {
          const cBase = cell(cond, base, metric, turn);
          const cTerse = cell(cond, terse, metric, turn);
          if (cBase.n === 0 || cTerse.n === 0) continue;
          const rd = riskDifference(cTerse, cBase);
          lines.push(
            `- **${cond}** ${label}: ${base}=${pct(cBase.p)}, ${terse}=${pct(cTerse.p)}, terse−full RD = ${fmtRD(rd)}`,
          );
        }
      }
    }
    // Gap comparison: does M−C spread widen under terse?
    lines.push("");
    lines.push("**Gap under terse vs full (M−C on m4/T4 and m1/T1):**");
    for (const base of baseModels) {
      const terse = `${base}-terse`;
      if (!allModels.includes(terse)) continue;
      for (const { metric, turn, label } of [
        { metric: "m4", turn: "T4", label: "m4/T4" },
        { metric: "m1", turn: "T1", label: "m1/T1" },
      ]) {
        const fullGap = hasBoth("M", "C", base, metric, turn)
          ? riskDifference(cell("M", base, metric, turn), cell("C", base, metric, turn)).diff
          : null;
        const terseGap = hasBoth("M", "C", terse, metric, turn)
          ? riskDifference(cell("M", terse, metric, turn), cell("C", terse, metric, turn)).diff
          : null;
        if (fullGap !== null && terseGap !== null) {
          const direction = terseGap > fullGap ? "widens" : "narrows";
          lines.push(
            `  - ${base} ${label}: full gap ${(fullGap * 100).toFixed(0)}pp, terse gap ${(terseGap * 100).toFixed(0)}pp — gap ${direction} under terse`,
          );
        }
      }
    }
    lines.push("");
  }

  // Provider comparison (M-vs-C gap across models).
  if (modelsWithMC.length >= 2) {
    lines.push("## Provider comparison (M−C gap)");
    lines.push("");
    for (const { metric, turn, label } of [
      { metric: "m4", turn: "T4", label: "trivia m4/T4" },
      { metric: "m1", turn: "T1", label: "cold-read m1/T1" },
    ]) {
      const parts = modelsWithMC
        .filter((m) => hasBoth("M", "C", m, metric, turn))
        .map((m) => {
          const rd = riskDifference(cell("M", m, metric, turn), cell("C", m, metric, turn));
          return `${m}: ${(rd.diff * 100).toFixed(0)}pp`;
        });
      if (parts.length) lines.push(`- **${label}**: ${parts.join(" vs ")}`);
    }
    lines.push("");
  }

  // Footer.
  lines.push("---");
  lines.push("");
  lines.push("## How to reproduce");
  lines.push("");
  lines.push("```sh");
  lines.push("npm run eval:score    # re-score transcripts → eval/artifacts/scores.json");
  lines.push("npm run eval:analyze  # compute CIs + risk differences → RESULTS.md");
  lines.push("npm run eval:charts   # render SVG charts → eval/charts/");
  lines.push("```");
  lines.push("");
  lines.push(
    "> All numbers regenerate deterministically from `eval/artifacts/scores.json`.",
  );

  const md = lines.join("\n");
  writeFileSync(resolve(import.meta.dirname, "../RESULTS.md"), md);
  console.log("wrote RESULTS.md");
}
