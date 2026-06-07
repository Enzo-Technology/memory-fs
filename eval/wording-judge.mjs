// eval/wording-judge.mjs — blinded record judging (j1-j4) + kappa for the spot-check.
export function extractWrittenRecords(run) {
  const recs = [];
  for (const t of run.transcripts ?? [])
    for (const c of t.toolCalls ?? [])
      if (/_write$/.test(c.name) || c.name === "memory_note") recs.push({ turn: t.turn, ...c.input });
  return recs;
}

export function blindRecord(r) {
  return { key: r.key ?? "(derived)", type: r.type ?? "note", tags: r.tags ?? [], body: r.content ?? "" };
}

export function cohenKappa(a, b) {
  const n = a.length;
  let agree = 0; const ca = {}, cb = {};
  for (let i = 0; i < n; i++) { if (a[i] === b[i]) agree++; ca[a[i]] = (ca[a[i]] || 0) + 1; cb[b[i]] = (cb[b[i]] || 0) + 1; }
  const po = agree / n;
  const labels = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  let pe = 0; for (const l of labels) pe += ((ca[l] || 0) / n) * ((cb[l] || 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const JUDGE_SYSTEM =
  "You are scoring records written to a team store. You see only the record (key, type, tags, body) " +
  "and, where relevant, a manifest of what an ideal teammate would have filed. Score: " +
  "(j1) key is concept-oriented not session-oriented [0 or 1]; " +
  "(j2) content class one of durable-shared | episodic-personal | mixed; " +
  "(j3) self-contained for a teammate with no transcript [1-5]; " +
  "(j4, only if a manifest is given) array of manifest item ids this record covers. " +
  'Return ONLY JSON: {"j1":0|1,"j2":"...","j3":1-5,"j4":[...]}. Do not reward verbosity.';

export async function judgeRecord(anthropic, blinded, manifest = null) {
  const user = manifest
    ? `Record:\n${JSON.stringify(blinded, null, 2)}\n\nManifest:\n${JSON.stringify(manifest, null, 2)}`
    : `Record:\n${JSON.stringify(blinded, null, 2)}`;
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 512, temperature: 0,
    system: JUDGE_SYSTEM, messages: [{ role: "user", content: user }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readdirSync, readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic();
  const root = resolve(import.meta.dirname, "artifacts");
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/p3-manifest.json"), "utf-8"));
  const out = [];
  const walk = (d) => existsSync(d) ? readdirSync(d) : [];
  for (const cond of walk(root)) for (const model of walk(resolve(root, cond)))
    for (const script of walk(resolve(root, cond, model)))
      for (const f of walk(resolve(root, cond, model, script))) {
        const run = JSON.parse(readFileSync(resolve(root, cond, model, script, f), "utf-8"));
        for (const r of extractWrittenRecords(run)) {
          const verdict = await judgeRecord(anthropic, blindRecord(r), script === "P3b" ? manifest : null);
          out.push({ condition: cond, model, script, turn: r.turn, verdict });
          process.stdout.write(".");
        }
      }
  writeFileSync(resolve(root, "judgments.json"), JSON.stringify(out, null, 2));
  console.log(`\njudged ${out.length} records`);
}
