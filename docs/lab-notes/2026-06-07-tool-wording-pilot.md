# Lab note — does tool wording steer what models file? (pilot)

**Date:** 2026-06-07 · **Status:** M/C/K + crossed cells complete (2 models, n=5); terse arm optional. Every number reproduces via `npm run eval:score && eval:analyze && eval:charts` (see `RESULTS.md`, `eval/charts/`).
**Spec:** `docs/plans/2026-06-07-tool-wording-experiment.md` · **Harness:** `eval/` · **Data:** `eval/artifacts/` (gitignored).

## Thesis under test
The product question — call the shared store **memory**, **context**, or **knowledge** — is really an *interface* question: the tool's **name + description + result strings are the filing policy** that tells a model what belongs in the store, when to read it, and when to maintain it. If models inherit the connotations of these words (memory = episodic/personal/automatic; context = curated/shared/load-before-acting; knowledge = settled reference), then identical backends under different vocabularies should produce **measurably different read/write/maintenance behavior**.

## Method (pilot)
- **Manipulation:** one renameable MCP server (`eval/server/`) re-exposes the *same* store under a condition's surface — tool **name + description + result strings fully swapped**, argument schemas held constant. Six surfaces exist (M/C/K/N + crossed MxC/CxM); the pilot ran **M (memory) vs C (context)** only.
- **Injection:** **full injection** — all 7 tool definitions in every model call (matches how Claude Desktop / most MCP clients work at this tool count). Tool order randomized per run (defeats prompt caching by design).
- **Models:** Claude **Sonnet 4.6** (adaptive thinking, effort:low) and OpenAI **gpt-5.5** (default light reasoning). Chosen as same-tier peers (Intelligence Index ≈ 57 vs 60). Both reason at low depth — matched and cheap.
- **Probes** (neutral system prompt, no store vocabulary; user turns never name the store):
  - **P1** cold start — T1 "draft a headline" (does it read first?), T2 direct recall.
  - **P2** working session atop a *real* scrubbed coding chat (CodeChat corpus, different chat per iter) — T3 contradiction, T4 trivia ("my dog Rex…"), T5 durable decision.
  - **P3b** end-of-session wrap-up (explicit "tidy up" cue).
- **n = 5** per cell. Deterministic metrics m1–m8 from tool-call logs; Wilson CIs.

## Findings — M vs C (n=5 per cell)

| Metric | Sonnet M / C | gpt-5.5 M / C | Read |
|---|---|---|---|
| **m4 trivia write** (T4 dog aside) | **5/5 / 0/5** | **3/5 / 0/5** | memory invites trivia; context suppresses it |
| **m1 unprompted read** (T1) | 0/5 / 0/5 | **1/5 / 5/5** | context makes gpt-5.5 read first; Sonnet never reads |
| m5 durable deposit (T5) | 5/5 / 5/5 | 5/5 / 5/5 | saturated — real conventions saved regardless |
| m6 wrap-up write (P3b) | 5/5 / 5/5 | 5/5 / 5/5 | saturated |
| m3a read-before-contradict (T3) | 1/5 / 0/5 | 1/5 / 1/5 | rarely reads the record it's about to contradict |
| **m3b supersede** (T3) | 5/5 *duplicate*, 0 update | 5/5 *duplicate*, 0 update | **nobody supersedes — everyone appends a duplicate** |
| m7 prune stale (P3b, explicit cue) | 5/5 / 5/5 | 5/5 / 4/5 | when *told* to tidy, all prune |

## Verdict against the preregistered hypotheses
- **H1 (memory files trivia more than context, ≥20pp) — CONFIRMED, large, cross-provider.** Sonnet 5/5 vs 0/5 (~100pp, non-overlapping Wilson CIs even at n=5); gpt-5.5 3/5 vs 0/5. The single cleanest result.
- **H2 (context reads more at cold start) — SUPPORTED for gpt-5.5, NULL for Sonnet.** "context"'s "read before acting" framing makes gpt-5.5 read every time (5/5 vs 1/5); Sonnet never reads unprompted in either condition. A genuine provider difference.
- **H3 (knowledge) — knowledge behaves like context.** K suppresses trivia (m4 0/5 both models) and reads-before-acting like context (m1 5/5 openai). Its curated/settled description raises the bar on junk the same way context does. ("Lowest write rate" not borne out — genuine deposits still saturate at 100%.)
- **H4 (description vs name) — CONFIRMED, decisively: the description dominates; the noun barely matters.** The crossed cells flip with the *description*, not the name: `MxC` (memory name + context description) behaves like **context** (m4 trivia 0/5, m1 read 5/5 openai); `CxM` (context name + memory description) behaves like **memory** (m4 trivia 3–4/5, m1 read 1/5). Both effects track the description regardless of the tool's noun.
- **H5 (effect shrinks with tier) — NOT ASSESSABLE** here: two cross-vendor flagships, not a same-vendor tier ladder.
- **H6 (context/knowledge supersede more on contradiction) — REFUTED in pilot.** *All* conditions and both models wrote a **new duplicate** rather than updating the contradicted record (0/20 supersedes), and rarely even read it first. Wording did not move this; the default is to **pollute the shared store**. (Directly motivates the `proposed→confirmed` write-review work.)

**Bottom line on the thesis:** *the tool surface is interface, not branding — confirmed,* but with a sharp refinement: **it's the *description*, not the noun.** Picking "memory" vs "context" vs "knowledge" matters far less than the **usage guidance you write into the description**. Episodic/personal framing ("memory…") invites trivia and skips reads; curated/shared framing ("context"/"knowledge…") suppresses junk and (for GPT) triggers read-before-acting — and a memory-*named* tool with a context *description* behaves like context. The effect concentrates on **discriminating junk from signal** (m4) and **read-before-acting** (m1, GPT). Genuine deposits and *instructed* maintenance saturate (wording-irrelevant); *unprompted* contradiction-handling fails uniformly (everyone duplicates, nobody supersedes — H6).

## Cost
Total model spend across all runs (M/C/K/crosses, both models), from recorded per-call usage: **$16.22 / $25** — Sonnet $6.66, gpt-5.5 $9.56. The blinded judge (j-metrics) was skipped: it crashed on a directory-walker bug (since fixed) and the deterministic m1–m8 carry the headline. The OpenAI adapter also gained a 90s fetch timeout after a stalled gpt-5.5 request hung one run (raw `fetch` has no built-in timeout, unlike the Anthropic SDK).

## MCP injection note (why this is realistic)
We swap the **entire per-tool surface** (name + description + result strings) across all 7 tools, and the harness **fully injects** every definition on every call. That's standard for small MCP servers. The alternative — **progressive disclosure / tool search** (load only relevant schemas on demand) — kicks in past ~30–50 tools. Hypothesis: under progressive disclosure the **noun matters more** (the model acts on sparse info — mostly the name). We test a cheap proxy: a **terse** surface (condition name kept, description neutralized to a generic stub) — if the m4/m1 gap *grows* in terse vs full-description, terminology matters more when tools aren't richly loaded.

## Reproducibility
All numbers regenerate from raw transcripts: `eval/artifacts/{cond}/{model}/{script}/{iter}.json` → `npm run eval:score` (scores.json) → `npm run eval:analyze` (`RESULTS.md`, Wilson CIs + Newcombe risk-difference) → `npm run eval:charts` (`eval/charts/*.svg`, `index.html`). Tool-surface snapshots per condition are committed in `eval/surfaces/`.

## Open / optional next
- **Terse arm** (name-only signal, `--terse`) — the progressive-disclosure test. H4 shows the noun is irrelevant *under full injection*; terse asks whether the noun matters when the description is stripped (≈ tool-search). ~$5, harness ready.
- **Similarity-gated writes** — the feature motivated by H6 (everyone duplicates): no near-dup ⇒ write `confirmed`; near-dup ⇒ require a confirm/`on_conflict` round-trip. Design: `docs/proposals/2026-06-07-similarity-gated-writes.md`.
- (Deferred) higher n for tight CIs; Haiku/Opus tier ladder for H5; ecological pass through a real host harness.

## Caveats
n=5 screening; effects this clean (m4, m1) would likely survive larger n, but treat magnitudes as provisional. Single fixed phrasing per probe. Two providers only. Reasoning held at low depth for both (cost + matching) — a high-effort rerun could shift results.
