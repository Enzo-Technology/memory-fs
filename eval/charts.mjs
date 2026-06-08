// eval/charts.mjs — dependency-free SVG bar charts for the wording experiment.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const scores = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "artifacts/scores.json"), "utf-8"),
);

// --- data helpers ---

const allConditions = [...new Set(scores.map((r) => r.condition))].sort();
const allModels = [...new Set(scores.map((r) => r.model))].sort();

/** Binary rate for (condition, model, metric, turn). Returns null if no data. */
function rate(cond, model, metric, turn) {
  const rows = scores.filter(
    (r) =>
      r.condition === cond &&
      r.model === model &&
      r.turn === turn &&
      r[metric] !== undefined &&
      r[metric] !== null,
  );
  if (rows.length === 0) return null;
  return rows.filter((r) => r[metric] === 1).length / rows.length;
}

const baseModels = allModels.filter((m) => !m.endsWith("-terse"));
const terseModels = allModels.filter((m) => m.endsWith("-terse"));
const hasTerse = terseModels.length > 0;

// --- SVG helper ---

// Distinct palette (colour-blind-friendly-ish).
const PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948", "#b07aa1"];

/**
 * Render a grouped bar chart as an SVG string.
 *
 * @param {{
 *   title: string,
 *   groups: string[],        // x-axis group labels (e.g. conditions)
 *   series: {label: string, values: (number|null)[]}[],  // one per model
 *   yLabel?: string,
 *   fmt?: (v: number) => string,
 * }} opts
 */
function barChart({ title, groups, series, yLabel = "Rate", fmt = (v) => `${Math.round(v * 100)}%` }) {
  const W = 700, H = 420;
  const marginTop = 56, marginRight = 20, marginBottom = 80, marginLeft = 52;
  const chartW = W - marginLeft - marginRight;
  const chartH = H - marginTop - marginBottom;

  const numGroups = groups.length;
  const numSeries = series.length;
  const groupW = chartW / numGroups;
  const barPad = 4;
  const barW = Math.max(14, (groupW - barPad * (numSeries + 1)) / numSeries);

  // Y scale: 0–100%.
  const yMax = 1;
  const yToSvg = (v) => chartH - (v / yMax) * chartH;

  // Grid lines at 0, 25, 50, 75, 100%.
  const gridLines = [0, 0.25, 0.5, 0.75, 1.0];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">`;

  // Background.
  svg += `<rect width="${W}" height="${H}" fill="#fff"/>`;

  // Title.
  svg += `<text x="${W / 2}" y="30" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${title}</text>`;

  // Chart area clip / transform.
  svg += `<g transform="translate(${marginLeft},${marginTop})">`;

  // Grid lines + y-axis labels.
  for (const g of gridLines) {
    const y = yToSvg(g);
    svg += `<line x1="0" y1="${y}" x2="${chartW}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;
    svg += `<text x="-6" y="${y + 4}" text-anchor="end" font-size="11" fill="#555">${fmt(g)}</text>`;
  }

  // Y-axis label.
  svg += `<text transform="rotate(-90)" x="${-chartH / 2}" y="-40" text-anchor="middle" font-size="12" fill="#555">${yLabel}</text>`;

  // Bars.
  for (let gi = 0; gi < numGroups; gi++) {
    const groupX = gi * groupW;
    for (let si = 0; si < numSeries; si++) {
      const v = series[si].values[gi];
      if (v === null || v === undefined) continue;
      const color = PALETTE[si % PALETTE.length];
      const bx = groupX + barPad * (si + 1) + barW * si;
      const by = yToSvg(v);
      const bh = chartH - yToSvg(v);
      svg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="2"/>`;
      // Value label on bar.
      svg += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${color}">${fmt(v)}</text>`;
    }
    // Group label.
    svg += `<text x="${(groupX + groupW / 2).toFixed(1)}" y="${chartH + 18}" text-anchor="middle" font-size="12" fill="#333">${groups[gi]}</text>`;
  }

  // Axes.
  svg += `<line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#999" stroke-width="1"/>`;
  svg += `<line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#999" stroke-width="1"/>`;

  svg += `</g>`; // end chart area

  // Legend (below chart).
  const legendY = H - marginBottom + 36;
  const legendItemW = Math.min(120, W / numSeries);
  const legendStartX = Math.max(marginLeft, (W - legendItemW * numSeries) / 2);
  for (let si = 0; si < numSeries; si++) {
    const lx = legendStartX + si * legendItemW;
    const color = PALETTE[si % PALETTE.length];
    svg += `<rect x="${lx}" y="${legendY}" width="12" height="12" fill="${color}" rx="1"/>`;
    svg += `<text x="${lx + 16}" y="${legendY + 10}" font-size="11" fill="#333">${series[si].label}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// --- chart definitions ---

const outDir = resolve(import.meta.dirname, "charts");
mkdirSync(outDir, { recursive: true });

const generated = [];

// Helper: write SVG and record filename + title.
function emit(filename, title, svgStr) {
  writeFileSync(resolve(outDir, filename), svgStr);
  generated.push({ filename, title });
  console.log(`wrote eval/charts/${filename}`);
}

// m4-trivia.svg — trivia-write rate (m4/T4) by condition, grouped bars per model.
{
  const title = "Trivia-write rate (m4 / T4) by condition";
  const series = baseModels.map((model, i) => ({
    label: model,
    values: allConditions.map((cond) => rate(cond, model, "m4", "T4")),
  }));
  emit("m4-trivia.svg", title, barChart({ title, groups: allConditions, series, yLabel: "Write rate" }));
}

// m1-read.svg — unprompted-read rate (m1/T1) by condition × model.
{
  const title = "Unprompted-read rate (m1 / T1) by condition";
  const series = baseModels.map((model) => ({
    label: model,
    values: allConditions.map((cond) => rate(cond, model, "m1", "T1")),
  }));
  emit("m1-read.svg", title, barChart({ title, groups: allConditions, series, yLabel: "Read rate" }));
}

// Terse vs full charts — only if terse models exist.
if (hasTerse) {
  // Build series: for each base model, include base + terse variant.
  const m4Series = [];
  const m1Series = [];
  for (const base of baseModels) {
    const terse = `${base}-terse`;
    if (!allModels.includes(terse)) continue;
    m4Series.push(
      { label: `${base} full`, values: allConditions.map((c) => rate(c, base, "m4", "T4")) },
      { label: `${terse}`, values: allConditions.map((c) => rate(c, terse, "m4", "T4")) },
    );
    m1Series.push(
      { label: `${base} full`, values: allConditions.map((c) => rate(c, base, "m1", "T1")) },
      { label: `${terse}`, values: allConditions.map((c) => rate(c, terse, "m1", "T1")) },
    );
  }
  if (m4Series.length) {
    emit(
      "m4-full-vs-terse.svg",
      "Trivia-write rate (m4/T4): full vs terse wording",
      barChart({ title: "Trivia-write rate (m4/T4): full vs terse wording", groups: allConditions, series: m4Series, yLabel: "Write rate" }),
    );
    emit(
      "m1-full-vs-terse.svg",
      "Unprompted-read rate (m1/T1): full vs terse wording",
      barChart({ title: "Unprompted-read rate (m1/T1): full vs terse wording", groups: allConditions, series: m1Series, yLabel: "Read rate" }),
    );
  }
}

// index.html — embeds all SVGs inline with <h2> captions.
{
  const items = generated
    .map(
      ({ filename, title }) =>
        `  <section>\n    <h2>${title}</h2>\n    ${readFileSync(resolve(outDir, filename), "utf-8")}\n  </section>`,
    )
    .join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tool-wording experiment — charts</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; background: #fafafa; color: #222; }
  h1 { font-size: 1.4em; border-bottom: 2px solid #ccc; padding-bottom: 8px; }
  h2 { font-size: 1.1em; margin-top: 2em; }
  section svg { display: block; max-width: 100%; height: auto; border: 1px solid #e0e0e0; border-radius: 4px; }
</style>
</head>
<body>
<h1>Tool-wording experiment — charts</h1>
${items}
</body>
</html>
`;
  writeFileSync(resolve(outDir, "index.html"), html);
  console.log("wrote eval/charts/index.html");
}
