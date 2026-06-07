// eval/wording-score.mjs — deterministic metrics from archived transcripts.
// Turn IDs emitted by eval/scripts.mjs: "T1","T2","T3","T4","T5","P3b".
// Matchers key on tool-name suffix only — noun prefix is condition-specific.
const isWrite = (n) => /_write$/.test(n) || n === "memory_note";
const isRead = (n) => /_(read|search|browse|backlinks)$/.test(n) || n === "memory_recall";
const isDelete = (n) => /_delete$/.test(n);

// argStr: JSON-stringify the tool call input and lowercase, for safe substring matching.
const argStr = (c) => JSON.stringify(c.input ?? {}).toLowerCase();

export function scoreTurn(t) {
  const calls = t.toolCalls ?? [];
  const s = {};

  if (t.turn === "T1") {
    // m1: a READ call (not any tool) preceded the first assistant text
    const first = (t.toolCalls ?? [])[0];
    s.m1 = (t.readBeforeAnswer && first && isRead(first.name)) ? 1 : 0;
  }

  if (t.turn === "T2") {
    // m2: read occurred AND finalText contains the exact hardened date AND no other 2026-xx-xx date
    const read = calls.some((c) => isRead(c.name));
    const hasDate = /2026-06-05/.test(t.finalText ?? "");
    const otherDate = /\b2026-(?!06-05)\d{2}-\d{2}\b/.test(t.finalText ?? "");
    s.m2 = read && hasDate && !otherDate ? 1 : 0;
  }

  if (t.turn === "T3") {
    // m3a: a read call whose args mention 'product-scope' OR 'desktop'
    s.m3a = calls.some(
      (c) => isRead(c.name) && /product-scope|desktop/.test(argStr(c)),
    )
      ? 1
      : 0;

    // m3b: a _write whose args mention 'product-scope' => "update";
    // else if any _write exists => "duplicate"; else "none"
    const w = calls.find((c) => isWrite(c.name));
    if (!w) {
      s.m3b = "none";
    } else if (argStr(w).includes("product-scope")) {
      s.m3b = "update";
    } else {
      s.m3b = "duplicate";
    }
  }

  if (t.turn === "T4") {
    // m4: any _write whose args mention rex/dog/mailman (trivia false-positive detector)
    s.m4 = calls.some(
      (c) => isWrite(c.name) && /\brex\b|\bdog\b|mailman/.test(argStr(c)),
    )
      ? 1
      : 0;
  }

  if (t.turn === "T5") {
    // m5: any _write whose args mention 'apperror' OR 'error code' (durable AppError convention)
    const w = calls.find((c) => isWrite(c.name) && /apperror|error code/.test(argStr(c)));
    s.m5 = w ? 1 : 0;

    // m8: of new writes, fraction with ≥1 _link call (null when no writes)
    const writes = calls.filter((c) => isWrite(c.name));
    s.m8 = writes.length ? (calls.some((c) => /_link$/.test(c.name)) ? 1 : 0) : null;
  }

  if (t.turn === "P3b") {
    // m6: any _write after the closing cue
    s.m6 = calls.some((c) => isWrite(c.name)) ? 1 : 0;

    // m7a: a read call whose args mention 'deploy-smoke' or 'smoke'
    s.m7a = calls.some((c) => isRead(c.name) && /deploy-smoke|smoke/.test(argStr(c))) ? 1 : 0;

    // m7b: a _delete or _write touching 'deploy-smoke'
    s.m7b = calls.some(
      (c) => (isDelete(c.name) || isWrite(c.name)) && /deploy-smoke/.test(argStr(c)),
    )
      ? 1
      : 0;
  }

  return s;
}

// Aggregator — reads the archive and writes eval/artifacts/scores.json.
// Guarded behind import.meta.url check so importing scoreTurn doesn't trigger I/O.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function* iterArtifacts(root) {
  if (!existsSync(root)) return;
  for (const cond of readdirSync(root))
    for (const model of readdirSync(resolve(root, cond)))
      for (const script of readdirSync(resolve(root, cond, model)))
        for (const f of readdirSync(resolve(root, cond, model, script)))
          yield JSON.parse(
            readFileSync(resolve(root, cond, model, script, f), "utf-8"),
          );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, "artifacts");
  const rows = [];
  for (const run of iterArtifacts(root))
    for (const t of run.transcripts)
      rows.push({
        condition: run.condition,
        model: run.model,
        script: run.scriptId,
        iter: run.iter,
        turn: t.turn,
        ...scoreTurn(t),
      });
  writeFileSync(
    resolve(import.meta.dirname, "artifacts/scores.json"),
    JSON.stringify(rows, null, 2),
  );
  console.log(`scored ${rows.length} turns`);
}
