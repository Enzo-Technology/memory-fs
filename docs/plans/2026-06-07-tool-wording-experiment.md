# Experiment spec: does tool wording steer what models file in a shared store?

**Status**: spec for implementation (specrev:2). Audience: implementing agent.
**Companion**: `research/memory-rhythms.md` (background research — to be written).
**Date**: 2026-06-07. **Owner**: Ben.
**Supersedes**: the v1 draft pasted in chat 2026-06-07. Changes from v1 are flagged inline as **[rev2]**.

---

## 0. TL;DR for the implementing agent

Build a renameable wrapper around the enzo memory MCP server (one `NAMING` env var swaps tool names + descriptions + result strings; backend identical). Run scripted conversations across wording conditions × model tiers × conversation phases, scoring with deterministic tool-call assertions plus a blinded LLM judge.

**[rev2] Engine decision — read this first.** Do **not** build on `@mcpjam/sdk`. The repo already has a working harness at `eval/run-eval.mjs` that uses the **Anthropic SDK + MCP stdio client** directly: it discovers tools from the server, calls `messages.create({ system, tools, messages })`, and runs cells across variants. Because `messages.create` accepts an arbitrary message array, **fabricated pre-seeded history (P2/P3) is supported natively** — the single hardest problem in v1's §7 disappears. Extend that harness; MCPJam is demoted to optional visual sanity-checking and tool-surface snapshots (its existing role in `eval/README.md`).

**[rev2] Allocation, not grid.** v1 spread n=20 evenly across 54 cells; that is underpowered for almost every hypothesis. Instead: run a **pilot first**, then spend the budget **concentrated on the 2–3 comparisons that drive the naming decision**, not an even factorial. Details in §3 and §8.

---

## 0.5 Addendum (rev3) — generic substrate, real-chat P1/P2

**[rev3]** The experiment is now **generic, not enzo-specific**, and P1/P2 histories come from a **real generic-chat corpus**. This supersedes the enzo-flavored materials in §4–§6 below; where they conflict, this addendum wins. Rationale: dropping enzo specifics removes the probe/plant coupling that blocked external data, and a diverse real-chat corpus raises ecological validity. Conditions (§3 Factor A), models, metrics, and analysis are unchanged.

**Priming control.** The history is held constant across conditions *per iteration* (M-iter-i and C-iter-i use the SAME chat), so it's a paired design — history content differences out of the M-vs-C comparison. Residual: "memory" is more frequent than "knowledge" in coding chat, mildly favoring condition M. Mitigation: **light-scrub the three target nouns** from sampled chats (see scrub map) — preserves real texture, removes the specific confound.

### Canonical generic scenario (use these exact strings everywhere)
Stand-in product: **"Acme"**, a fictional dev-tools CLI (no real-world priors). Used only in the seeded store + probe turns — NOT in the P2 chat history (which is real generic coding talk).

**Seeded store** (replaces the enzo records; same shape, Task 5):
- `project:acme/core-thesis` — type `project`, tags `["core-thesis","thesis-under-test"]`, body contains "hardened 2026-06-05". (T2 target; m2 keys on `2026-06-05`.)
- `project:acme/product-scope` — type `project`, tags `["anchor","positioning"]`, body says the product "ships as a CLI plus a desktop app". (T3 target; m3 keys on key `product-scope` + word `desktop`.)
- `project:acme/deploy-smoke` — type `note`, stale. (P3 prune target; m7 keys on `deploy-smoke`.)
- 2 filler `reference` records (generic).

**Probes** (genericized; user turns still never name the store):
- P1/T1 (fresh): "Draft a one-line headline for the Acme landing page."
- P1/T2 (fresh): "What's our core product thesis, and when did we last harden it?"
- P2/T3: "Quick update before we continue — we talked it over this morning and we're dropping the desktop app. CLI-first is the bet now. Carry on with what we were doing."
- P2/T4: "ha, sorry, got distracted — my dog Rex was barking at the mailman. anyway, where were we?"
- P2/T5: "One more thing to lock in: all our CLI errors go through the new `AppError` type with an error code — that's the convention from now on, every module."
- P3b: "Before we close out: wrap up — make sure anything the team needs survives this session, and tidy up anything stale."

**P2 history corpus** — `eval/fixtures/p2-corpus/NNN.json`, each an array of `{role:"user"|"assistant", content:"<string>"}`, sourced from real generic coding chats (CodeChat, ODC-BY — attribute in `eval/fixtures/p2-corpus/SOURCE.md`). Each: 8–14 turns, NO tool blocks, scrubbed of the three nouns. ≥6 files for the pilot (n=5 + headroom); ~24 for the full grid. The runner picks `corpus[iter % corpus.length]` so the same chat is used across conditions at a given iter.

**Scrub map** (case-insensitive, whole + in-compound): `memory`→`RAM`/`allocation` (per sense), `context`→`setup`/`situation`, `knowledge`→`understanding`. Also strip tool-name fragments. After scrub, the fixtures contract regex must find zero hits.

**P3 history + manifest** — hand-authored **generic** (de-enzo'd), manifest scoring intact. Plants: `apperror` (durable — the AppError convention), `telemetry-optout` (durable), `config-format` (reverted: TOML→JSON same session), `rex` (aside), `auth-provider` (deferred). deploy-smoke established obsolete. (This is a light rename of the existing P3 fixture: `EnzoError`→`AppError`, remove enzo brand.)

**Scorer deltas (Task 9):** m3 read-target keys on `product-scope`/`desktop`; m3 supersede keys on `product-scope`; m5 keys on `apperror`/`error code`. m2 (`2026-06-05`), m4 (`rex`/`dog`/`mailman`), m7 (`deploy-smoke`) unchanged.

## 1. Background and motivation

The enzo shared store (namespaced records, types, tags, FTS, links/backlinks) shares key information, skills, and direction across codebases and teammates. The open product question is what to *call* it — memory, context, knowledge — and the working hypothesis is that the name matters less as branding than as **interface**: tool names and descriptions are the filing policy that tells a model what belongs, when to read it, and when to maintain it.

PKM research (`memory-rhythms.md`) predicts distinct behavioral signatures: "memory" → episodic, personal, automatic capture; "context" → curated, shared, load-before-work grounding; "knowledge" → settled reference. If models inherit these connotations, identical backends with different vocabularies should produce measurably different read/write/maintenance behavior.

This experiment also has a known live failure to motivate it: an agent autonomously wrote a confidently-wrong "settled" fact to the shared store (Enzo/Enso naming, direction inverted). The write-policy work (proposed→confirmed) is tracked separately; this experiment asks the upstream question of whether wording itself biases *what* gets written.

## 2. Research questions and preregistered hypotheses

**RQ1 (read):** Does wording change whether a model consults the store unprompted before acting?
**RQ2 (write):** Does wording change *what* gets deposited — durable shared decisions vs episodic/personal trivia?
**RQ3 (maintain):** Does wording change end-of-session behavior — filing, superseding, pruning?
**RQ4 (channel):** Is the effect carried by the tool *name* or the *description*?
**RQ5 (tier):** Does the effect shrink as model capability rises?

**[rev2] Hypotheses are tiered by what this budget can actually resolve.** Primary = decision-driving, powered. Exploratory = reported with CIs but underpowered; not used to make the call.

Preregistered predictions (record before any runs; report against them):

**Primary (drive the naming decision, get the n):**
- **H1**: `memory` stores personal trivia (probe T4) at a higher rate than `context`. Predicted gap ≥ 20pp.
- **H2**: `context` produces a higher unprompted-read rate at session start (probe T1) than `memory`.
- **H4**: Description dominates name: crossed cells (memory names × context descriptions) behave like `context`, not `memory`.

**Exploratory (reported, not decision-gating):**
- **H3**: `knowledge` produces the lowest overall write rate.
- **H5**: Condition gaps narrow monotonically from small → large tier.
- **H6**: On contradiction (T3), `context`/`knowledge` update-or-supersede more; `memory` appends a duplicate more.

**[rev2] H0 reframed.** v1 claimed a null would prove "naming is free." It can't: at this n, failing to reject ≠ equivalence (absence of evidence). A null result here means only **"no large effect detected (>~25–30pp)."** To claim naming is genuinely free we'd need an equivalence test (TOST) against pre-set bounds, which this budget cannot support — state that explicitly in RESULTS.md rather than overclaiming.

## 3. Design

**[rev2] Two-stage, allocation-first.**

### Stage 0 — Pilot (go/no-go)
Conditions **M + C** × **Sonnet** × all 3 scripts × **n=5** (30 runs). Purpose: shake out harness, scoring, judge rubric, and read the M-vs-C separation on m1/m4/m5.
- **Go/no-go rule:** if pilot shows a clear M-vs-C separation (≳15pp) on m1 or m4, proceed to Stage 1 concentrated grid. If murky (<5pp), per H5 run the **Haiku** M/C cells before concluding anything (the effect, if real, lives at the small tier). The pilot may itself answer the practical question — if the gap is large and obvious, the full grid is confirmation you may not need.

### Stage 1 — Concentrated grid (only the comparisons that pay)
Not an even 6×3×3. Allocate n where the preregistered primary tests live:

| Cell group | Conditions | Models | Scripts | n | Serves |
|---|---|---|---|---|---|
| Core read/write | M, C | Haiku, Sonnet, Opus | P1, P2 | 60 | H1, H2, H5 |
| Channel | MxC, CxM | Sonnet | P1, P2 | 60 | H4 |
| Knowledge arm | K | Sonnet | P1, P2 | 30 | H3 |
| Neutral control | N | Sonnet | P1, P2 | 30 | leakage baseline |
| **[rev2] Production surface** | **PROD** | Sonnet | P1, P2 | 30 | what we actually ship |
| Maintenance | M, C, K | Sonnet | P3b | 30 | RQ3 (best probe/$, see §8) |

n is per (condition×model×script) cell. Exact totals fall out of the table; estimate after pilot. The point: **60–90 effective observations on M-vs-C and on the channel test**, not 20 spread thin.

### Factor A — wording condition

Hold constant: tool schemas, argument names, backend behavior, verb suffixes. Vary only noun prefix, description vocabulary, and result-string phrasing (a write that answers "Memory saved" reinforces the frame).

**[rev2]** Normalize verbs to neutral form so the noun is the only signal: `{noun}_write`, `{noun}_read`, `{noun}_search`, `{noun}_browse`, `{noun}_link`, `{noun}_backlinks`, `{noun}_delete`.

| ID | Name prefix | Description framing |
|---|---|---|
| **M** | `memory_` | "Store and recall memories about the user and your past conversations. Use to remember things for later." |
| **C** | `context_` | "Shared context for the team: key information, decisions, skills, direction shared across codebases and teammates. Read before acting; update when direction changes." |
| **K** | `knowledge_` | "Team knowledge base: settled facts, conventions, reference material. Add entries when something is established and durable." |
| **N** (control) | `store_` | Minimal/neutral: "Write a record to the store." / "Search records." No guidance vocabulary. |
| **MxC** (cross) | `memory_` | C's descriptions verbatim |
| **CxM** (cross) | `context_` | M's descriptions verbatim |
| **[rev2] PROD** | `memory_` | The **real production surface** — actual `memory_note`/`memory_recall`/etc. names and descriptions, unmodified. Tells us about the thing in the wild, not only the clean abstraction. |

Full per-tool text in `conditions.json` (template in Appendix A). Within a condition, descriptions differ from siblings *only* in framing vocabulary, never information content — same length ±15%, same structure. One author/pass writes all surfaces to keep register constant.

### Factor B — conversation phase (script)

| Script | Phase | Tests | Pre-seeded history? |
|---|---|---|---|
| **P1** | Cold start | Unprompted read before acting; recall vs hallucination | No |
| **P2** | Working session | Deposits: durable decision, trivia discrimination, contradiction | Yes — fabricated history |
| **P3** | End of long context | Wrap-up filing, superseding, pruning | Yes — long fabricated history |

**[rev2]** All three scripts run through the **same** Anthropic-SDK harness; P2/P3 simply prepend the fabricated `messages` array. No second code path.

### Factor C — model

**[rev2] Verify exact model IDs against the API before freezing** (`/claude-api` or the models endpoint) — do not hardcode from memory.
- Small: `claude-haiku-4-5-20251001`
- Mid: `claude-sonnet-4-6`
- Large: **current flagship Opus** — confirm the live ID (Opus 4.8 = `claude-opus-4-8` at time of writing; v1 specced 4.6, which is not the shipping tier users run). Test the tier your users actually deploy on.
- Optional extension: one OpenAI + one open model via OpenRouter, same harness. Not v1.

### Held constant
- **Neutral system prompt**, no store vocabulary, no instruction to use tools (that *is* the DV): "You are an engineering assistant working with the enzo team. You have access to tools. Help the user with their requests." Grep it for memory/context/knowledge — any mention is a confound.
- **Temperature 1.0** (realistic; variance handled by n). Record it; note if a provider ignores it.
- `maxSteps`/tool-loop cap 10, 60s/turn timeout.
- **Fresh store per iteration**: copy `fixtures/seed-db/` to a temp `MEMORY_FS_DB`/`DATA_ROOT` per run. Never share state — prior writes contaminate later reads. (The existing harness already mints a fresh DB per server connect via `randomUUID`; extend that to seed from the fixture.)
- **[rev2] Tool order**: the existing harness *randomizes* tool order per run (BFCL shows position matters). Keep randomizing **but log the order/seed per run** so it's reconstructable. Randomization removes a position confound; the added variance is absorbed by n. (This reverses v1's "hold constant" — randomize-and-log is the better practice and is already implemented.)

## 4. Materials — scripts and probes

All user turns verbatim and frozen before runs. **User turns never name the store** — the only vocabulary signal is the tool surface. Where a turn references past work it says "what we have so far" or similar.

### Script P1 — cold start (2 turns)
Seeded store contains positioning records (Appendix B). No history.
- **T1 (implicit-relevance)**: "Draft a one-line headline for the enzo landing page." → *m1*: does it search/browse/read before drafting? (Seeded `core-pain` / `what-we-solve-for` materially change the right answer.)
- **T2 (direct-recall)**: "What's our core pain hypothesis, and when did we last harden it?" → *m2*.
  - **[rev2] m2 contamination fix**: run T2 as its **own fresh run** (not `context: t1`), so the store isn't already in-context from T1's read. Otherwise m2 measures "read across the block," not cold recall. Pick one and label it; fresh-run is cleaner.

### Script P2 — mid-session (~10-turn fabricated history + 3 probes)
History = a working session iterating on the enzo CLI onboarding flow. `fixtures/p2-history.json`. **Zero tool calls** (so the model isn't imitating in-context tool behavior — the whole point of fabrication) and **zero store vocabulary**.

- **T3 (contradiction/supersede)**: "Quick update before we continue — we talked it over this morning and we're killing the desktop app. CLI-first is the bet now. Carry on with the onboarding flow." → seeded `what-we-solve-for` references the desktop app. Outcome ∈ {nothing / new duplicate / update-or-supersede (correct)}.
  - **[rev2] m3 is a joint read×act metric.** To supersede the record the model must first *know it exists*, but history has zero tool calls and the store is fresh. So decompose: report **read-rate** and **conditional-supersede-rate given a read** separately. A condition that reads less will look like it supersedes less; don't conflate. Same caveat applies to m7 (pruning) in P3.
- **T4 (trivia discriminator — single most diagnostic)**: "ha, sorry, got distracted — my dog Rex was barking at the mailman. anyway, where were we?" → *m4*: any write mentioning Rex/dog is a false positive for a shared store.
- **T5 (durable-decision)**: "One more thing to lock in: all enzo CLI errors go through the new `EnzoError` type with an error code — that's the convention from now on, every crate." → *m5* deposit rate; record type (`reference`/`project` vs `note`); key style (concept- vs session-keyed); whether linked.

### Script P3 — end of long context (~30-turn / 6–8k-token history + closing cue)
History contains, scattered naturally, **5 plantable items**: 2 durable decisions, 1 changed-then-reverted decision (filing the reverted version is an error), 1 personal aside, 1 explicitly-deferred open question. Also establishes seeded `deploy-smoke` as obsolete (prune target). Manifest + ideal filing in `fixtures/p3-manifest.json`.

**[rev2] Run P3b only as primary** (the implicit-cue P3a is interesting but doubles cost for the lower-information variant; defer P3a to a follow-up if P3b shows signal):
- **P3b (explicit cue)**: "Before we close out: wrap up — make sure anything the team needs survives this session, and tidy up anything stale."

*Measures*: wrap-up write rate (m6); recall/precision of filed items vs manifest (filed both durable decisions? skipped the reverted one and the aside?); supersede/prune of `deploy-smoke` (m7, joint metric — see m3 caveat); key/type/link quality.

**[rev2] P3 is the best probe per dollar**: 5 item-decisions × n ≈ 150 graded decisions/cell at n=30, far better powered than the binary T1/T4 events. Weight budget here accordingly (already reflected in §3's maintenance row).

## 5. Apparatus

### Server under test — `eval/server/` (renameable wrapper)
Thin MCP stdio wrapper around the enzo store. **[rev2] Reuse the production `buildMcpServer` + store**; the wrapper only remaps tool name/description/result-string per `NAMING`. Requirements:
- `NAMING=<M|C|K|N|MxC|CxM|PROD>` selects surface from `conditions.json`. PROD passes through the real server unmodified.
- `MEMORY_FS_DB`/`DATA_ROOT` isolates state; harness seeds from `fixtures/seed-db/` per iteration.
- Tool order randomized per run by the harness (not the server); log the seed.

### Seed fixtures — `fixtures/seed-records.json` (Appendix B)
Mirror the real store, scrubbed: `project:enzo/core-pain` (tag `thesis-under-test`, body "hardened 2026-06-05"), `project:enzo/what-we-solve-for` (mentions desktop app — T3 target), `project:enzo/deploy-smoke` (stale — P3 prune target), + 2 filler `reference` records so search isn't trivially exhaustive. Build script bakes these into `fixtures/seed-db/`.

## 6. Measures and scoring

### Primary (deterministic, from tool-call logs)
| ID | Metric | Probe | Operationalization |
|---|---|---|---|
| m1 | Unprompted-read rate | T1 | any `_search`/`_browse`/`_read` before first non-tool answer token |
| m2 | Recall accuracy | T2 | read occurred AND answer contains "2026-06-05" (regex) AND no fabricated date |
| m3a | Read-target rate | T3 | model read `what-we-solve-for` before acting **[rev2 split]** |
| m3b | Conditional-supersede rate | T3 | given m3a, `_write` to existing key (update) vs new-key duplicate vs nothing **[rev2 split]** |
| m4 | Trivia false-positive rate | T4 | any `_write` whose args mention Rex/dog |
| m5 | Durable-deposit rate | T5 | any `_write` capturing the EnzoError convention (args contain "EnzoError"/"error code") |
| m6 | Wrap-up write rate | P3b | ≥1 `_write` after closing cue |
| m7 | Pruning rate | P3 | `_delete` or superseding `_write` touching `deploy-smoke` (joint w/ read — caveat per m3) |
| m8 | Link rate | T5, P3 | fraction of new writes with ≥1 `_link` |

### Secondary (blinded LLM judge — Appendix C)
- **j1 Key style**: concept- vs session-keyed [0/1].
- **j2 Content class**: durable-shared / episodic-personal / mixed.
- **j3 Self-containedness**: makes sense to a teammate with no transcript [1–5].
- **j4 Filing recall/precision (P3)**: vs `p3-manifest.json` — which of 5 items filed; was the reverted decision or the aside erroneously filed?

Judge: fixed model (Sonnet, temp 0), **blinded** — sees only record (key/type/tags/body) + manifest, never tool names/descriptions. **Human spot-check 10% of judged items**; report Cohen's κ; if κ < 0.7, fix rubric before trusting j-metrics.

## 7. Implementation

**[rev2] Built on the existing `eval/` harness, not MCPJam.** The Anthropic-SDK + MCP-stdio-client loop already in `eval/run-eval.mjs` does tool discovery, randomized order, temp-1.0 multi-run cells, and — crucially — accepts arbitrary `messages` arrays, so fabricated history needs no special machinery.

### Harness shape (`evals/run.ts` or extend `eval/run-eval.mjs`)
```
for each (condition, model, script, iter):
  dbPath = seedFreshDb("fixtures/seed-db")          // copy, unique path
  tools  = discoverTools(server, { NAMING: condition, MEMORY_FS_DB: dbPath })
  messages = script.history ? [...loadHistory(script), probe] : [probe]
  res = anthropic.messages.create({
          model, temperature: 1.0, max_tokens: 1024,
          system: NEUTRAL_SP, tools: shuffleAndLog(tools), messages })
  // tool-use loop up to 10 steps, executing tool calls against the MCP client
  archive(res, dbStateAfter)                          // full transcript + final store
```
- **P1** = no history (T1, and T2 as its own fresh run per m2 fix).
- **P2/P3** = prepend `fixtures/*.json` history, then the probe turn.
- Run config: iterations per §3 table, **concurrency 2** (provider rate limits bind), retries 1. Provider errors/timeouts excluded + re-run (log exclusions); a model *choosing* not to call tools is data, never an exclusion.

### MCPJam — optional only
- `mcpjam tools list --format json -e NAMING=<cond> --command node --args server.js` to **snapshot each condition's tool surface**; commit the snapshots — they are the record of the manipulation.
- Inspector for ad-hoc visual sanity-check of a few cells before the full run.
- No dependency on `@mcpjam/sdk` `EvalTest`/`HostRunner`/dashboard for the run itself.

### Logging / archival
Serialize every iteration → `artifacts/{condition}/{model}/{script}/{iter}.json` (messages + tool calls + final store state + tool-order seed). **The transcript archive is the dataset; all metrics are recomputable from it.** `artifacts/` gitignored, retained.

## 8. Analysis plan

- Per cell: each primary metric as proportion with **Wilson 95% CI**.
- **[rev2] Honest power**: at n=20 the CI half-width is ±~20pp and Fisher's exact detects only ~35–45pp effects; that is why §3 concentrates n to **60–90** on the primary comparisons (M-vs-C, channel), where ~15–20pp effects become resolvable. Exploratory cells stay at n=30 and are reported as exploratory.
- Hypothesis tests on **preregistered primary pairs only**: M vs C on m4 (H1) and on m1 (H2); MxC vs M and MxC vs C jointly (H4). Fisher's exact; **report risk differences with CIs as the headline, p-values descriptive**.
- **[rev2] Multiple comparisons**: even preregistered, ~6–8 tests — state the family-wise stance up front (risk-differences-with-CIs as primary inference; p-values not used as a pass/fail gate), so one p<.05 isn't oversold.
- **H4 decision rule**: MxC "behaves like C" if |MxC−C| < |MxC−M| on m1 and m4 jointly.
- Exploratory: H3 (K write rate), H5 (tier trend, Cochran-Armitage on M–C gap — explicitly underpowered), H6 (3-way on m3b).
- **Variance/instability**: if a metric is bimodal across iterations within a cell (model flip-flops), that's a finding (instability), not noise to average.
- **[rev2] No equivalence claims** beyond "no large effect detected"; flag where TOST would be needed.

## 9. Validity threats and mitigations
- **Description information leakage**: C's description carries instruction ("Read before acting") that M's doesn't — part of the construct, but conflates connotation with explicit instruction. The **N control + crossed cells** decompose it. Acknowledge.
- **Verb normalization vs shipped surface**: the 6 normalized conditions aren't the real tools — mitigated by the **PROD condition [rev2]**, which tests the actual surface.
- **Single backend**: results are about this tool surface; replicate the top finding on one other store shape before generalizing.
- **Anthropic-only**: tier claims are Claude-tier until the OpenRouter extension runs.
- **Judge bias**: blinding + κ check.
- **Fabricated-history realism**: drafted once, hand-edited, frozen, never regenerated per run.
- **Prompt-wording sensitivity**: single fixed phrasings; a 3-paraphrase robustness pass on T4 is a cheap v2 if T4 drives the decision.

## 10. Deliverables
1. `eval/server/` — renameable wrapper + `conditions.json` (all 7 surfaces incl. PROD) + committed `tools-list` snapshots per condition.
2. `eval/fixtures/` — seed records + `seed-db/` builder, P2/P3 histories, P3 manifest.
3. Harness extension of `eval/run-eval.mjs` + `score.*` (deterministic) + `judge.*` (blinded) — `npm run eval:pilot` / `npm run eval:full`.
4. `artifacts/` — full transcript archive (gitignored).
5. `RESULTS.md` — preregistered predictions → observed rates w/ CIs → verdict per hypothesis → naming recommendation (with the "no-equivalence" honesty note).
6. `research/memory-rhythms.md` — the background research this preregistration rests on.

**Milestones**: (1) wrapper + fixtures + harness extension + **pilot (30 runs)** + human review of 10 transcripts → go/no-go + rubric fixes; (2) concentrated Stage-1 grid; (3) analysis + writeup. **Stop-early**: if pilot M-vs-C gaps < 5pp on m1/m4 at Sonnet, run Haiku M/C before concluding null (H5 puts the effect at the small tier).

---

## Appendix A — description template (instantiate per condition)
Per tool fill `{NOUN}`, `{FRAME}` (one sentence from §3), `{VERB_HINT}`. Example `_write`:
> M: "Save a memory. Use this to remember information about the user and past conversations for later."
> C: "Write a record to the shared context — key information, decisions, skills, and direction the team and other codebases rely on."
> K: "Add an entry to the team knowledge base — for settled facts, conventions, and reference material."
> N: "Write a record to the store."

Result strings follow suit: "Memory saved." / "Shared context updated." / "Knowledge base entry added." / "Record written."

## Appendix B — seed records (final text mirrors production store, scrubbed)
```json
[
  {"namespace":"project:enzo","key":"core-pain","type":"project","tags":["core-pain","thesis-under-test"],
   "body":"## Enzo — Core Pain (hardened 2026-06-05, thesis-under-test)\n..."},
  {"namespace":"project:enzo","key":"what-we-solve-for","type":"project","tags":["anchor","north-star","positioning"],
   "body":"## What Enzo solves for\n... ships as a CLI plus desktop app ..."},
  {"namespace":"project:enzo","key":"deploy-smoke","type":"note","tags":["deploy","smoke"],
   "body":"# Hosted deploy smoke\n(stale: superseded by CI pipeline per P3 history)"}
]
```

## Appendix C — judge prompt (skeleton)
System: "You are scoring records written to a team store. You see only the record (key, type, tags, body) and, where relevant, a manifest of what an ideal teammate would have filed. Score: (j1) key concept-oriented not session-oriented [0/1]; (j2) content durable-shared / episodic-personal / mixed; (j3) self-contained for a teammate with no transcript [1–5]; (j4, P3 only) which manifest items this record covers. Return JSON. Do not reward verbosity."

---

## Sources
MCPJam (optional tooling): docs index, CLI reference. Existing harness: `eval/run-eval.mjs`, `eval/README.md`, `eval/scoring-rubric.md`. Methodology background: `research/memory-rhythms.md`.
