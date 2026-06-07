# Memory rhythms: background for the tool-wording experiment

> This document was written before any experimental runs. Its purpose is to record the reasoning that grounds the preregistered hypotheses in `docs/plans/2026-06-07-tool-wording-experiment.md` (§2), so those hypotheses read as derived rather than invented.

---

## 1. Tool wording as filing policy

When a language model decides whether to save something, what to save, and when to consult what it has already saved, the tool names and descriptions are the primary signal it receives about what the tool is *for*. This is not a branding question. It is an interface question — closer to labeling a filing cabinet than to choosing a product name.

The parallel in human information systems is well established. Personal-knowledge-management traditions going back to Niklas Luhmann's Zettelkasten distinguish capturing a thought (fast, low-friction, triggered by encounter) from placing it in a structure that makes it retrievable (slower, requires a filing decision). More recent frameworks — Tiago Forte's PARA, the "second brain" literature — add a further distinction between material that is *active* (under current use), *reference* (stable, consulted on demand), and *archive* (no longer live but retained). These systems differ in what *belongs* and when you *reach for* them; the names are load-bearing, not decorative.

Cognitive science offers a parallel distinction: episodic memory (personally experienced, time-stamped, context-rich) versus semantic memory (de-contextualized, generalized, treated as settled fact). The episodic/semantic split predicts different retrieval behavior — episodic records are consulted to reconstruct what happened; semantic records are consulted to look up what is true. Neither is better; they serve different purposes and are triggered by different cues.

The three words under test carry these connotations into the model's filing decision:

- **Memory** maps to episodic and personal: something *you* experienced, *your* past conversations, remembered automatically because it happened. The implicit policy is capture-everything-personal; the threshold to write is low; the cue to read is "I might have seen this before."
- **Context** maps to curated and shared: something a *team* loads before acting, representing current direction, decisions that are live and subject to revision. The implicit policy is write-what-others-need-to-know; the cue to read is before-I-act-I-should-check.
- **Knowledge** maps to settled and reference: something that has been *established*, durable enough to look up. The implicit policy is write-only-when-confirmed; the threshold to write is highest; the cue to read is I-need-a-fact.

These connotations are not inventions of this experiment. They are the ordinary meanings of the words. The experiment asks whether models inherit them as behavioral biases when those words appear as tool prefixes.

---

## 2. Prior art: the near-duplicate problem

Two existing systems bear directly on this work.

**basic-memory** is an open-source MCP-based personal knowledge store that matches nearly the full data model of this project — namespaced records, FTS search, link/backlink traversal — and ships with a hosted offering. The gap is shared positioning: basic-memory is designed for individual use, not as a team store with shared state across agents and teammates.

**Claude's native auto-memory** (Anthropic's built-in memory layer) provides automatic capture of facts across conversations. It near-duplicates the episodic capture use case. The meaningful differentiation is again the shared dimension: native memory is per-user; the store here is per-team. The positioning wedge is "shared," not the data model.

This background is relevant to the experiment because it establishes that the *schema* is not the differentiator. What varies across the conditions under test is only the vocabulary — names, descriptions, result strings. That is the lever this experiment isolates.

---

## 3. Why the hypotheses follow

The causal story connecting the connotation model to each preregistered prediction:

**H1 — memory stores personal trivia (T4 probe) at a higher rate than context (predicted gap ≥ 20pp).** Probe T4 is a personal aside — the user's dog barked at the mailman. Under the *memory* frame, personal episodes are exactly what the tool is for; filing the aside is a sensible action. Under the *context* frame, the tool holds team-relevant decisions; filing personal trivia is a mismatch the description actively discourages ("key information, decisions, skills, direction the team and other codebases rely on"). The connotation model predicts a large write-rate gap on this probe — it is the most diagnostic single item, because the correct answer is unambiguous and the manipulation is at maximum strength.

**H2 — context produces a higher unprompted-read rate at cold start (T1) than memory.** The *context* framing carries an explicit read-before-acting norm ("Read before acting; update when direction changes"). The *memory* frame carries no such norm — memory is consulted when you think you might have seen something before, not as a pre-action ritual. T1 asks for a landing-page headline; a model under *context* framing has stronger signal that it should first survey what the team already has before drafting. The prediction is directional (context > memory) rather than claiming a specific magnitude, because the cold-start probe is more ambiguous than the trivia probe.

**H3 (exploratory) — knowledge produces the lowest overall write rate.** The *knowledge* frame requires that something be "settled" and "established" before deposit. Most conversational outputs — decisions in progress, working notes, trivia — do not clear this bar. The threshold-to-write is highest under this frame. This prediction is exploratory because the budget concentrates on the M-vs-C comparison; K cells are lower-powered.

**H4 — descriptions dominate names (crossed cells).** MxC pairs *memory* names with *context* descriptions; CxM pairs *context* names with *memory* descriptions. If the description framing is the primary signal — as the connotation model implies, since descriptions carry the behavioral guidance while names carry only the noun — then MxC should behave like C, not M, and CxM should behave like M. The crossed design is the channel isolation: it separates the contribution of noun from the contribution of instructional framing. Prior work on tool-selection in language models (e.g., BFCL benchmarks) shows that description content substantially influences tool choice; names matter less as long as they are syntactically plausible.

**H5 (exploratory) — condition gaps narrow as model capability rises.** More capable models have richer representations of the words in question; they may be more sensitive to the nuance in descriptions and less dependent on the name prefix as a heuristic shortcut. Alternatively, more capable models apply more calibrated filing judgment independent of wording. Either mechanism predicts the same direction: the M-vs-C gap should be largest at the small (Haiku) tier and smallest at the large (Opus) tier. This is exploratory because resolving a tier trend requires a dose-response shape across three tiers, which demands more power than the budget fully supports.

**H6 (exploratory) — contradiction handling differs across framings (T3 probe).** T3 tells the model that a seeded record is now out of date (the desktop app is dropped; the seeded record says it still exists). The correct action is to read the existing record and supersede it — not to ignore the update or to file a duplicate. Under the *context* frame, the norm to update direction changes is explicit; under the *memory* frame, the episodic default may be to *add* rather than *revise*. This predicts a higher supersede-rate (vs duplicate-rate) under context and knowledge. The metric (m3) is decomposed into a read-rate component and a conditional-supersede-rate to avoid conflating "didn't supersede because didn't read" with "did read but chose to duplicate."

---

## 4. Method choice

The experiment is deliberately generic — the stand-in product is a fictional CLI called "Acme," with no real-world priors, and the P1/P2 conversation histories are drawn from a real scrubbed coding-chat corpus (not hand-authored enzo materials). This is a design choice, not a constraint: dropping product-specific framing removes the coupling between probe content and product positioning, making the findings about *tool wording in general* rather than about one team's store. The scrub removes the three target nouns (`memory`, `context`, `knowledge`) from sampled histories to prevent the distribution of the word "memory" in natural coding chat from mildly biasing condition M; it preserves the authentic texture of the history while eliminating that specific confound.

This is a screening experiment. The pilot runs M vs C at Sonnet with n=5 per script — enough to detect a large gap (≳15pp) and confirm the harness fires correctly, not enough to make fine-grained equivalence claims. The full grid concentrates observations on the primary comparisons (M-vs-C, channel isolation via crossed cells) rather than spreading them evenly across a factorial. Statistical inference uses risk differences with Wilson confidence intervals as the headline; p-values are descriptive. A null result means "no large effect detected" — it does not license the claim that wording is free. An equivalence claim would require a TOST against pre-specified bounds that this budget cannot support, and `RESULTS.md` will say so explicitly.
