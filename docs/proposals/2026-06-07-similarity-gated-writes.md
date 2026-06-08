# Proposal — similarity-gated writes (auto-confirm vs confirm-submit)

**Status:** proposal · **Date:** 2026-06-07 · **Motivated by:** the tool-wording pilot's H6 result.

## Problem (empirically grounded)
The wording pilot (`docs/lab-notes/2026-06-07-tool-wording-pilot.md`) showed that on a contradiction probe — new info that should *update* an existing record — **every condition and both models (Sonnet, gpt-5.5) wrote a new duplicate instead of superseding (0/20), and rarely even read the existing record first.** Tool wording did not fix this. Left alone, autonomous agents **pollute the shared store with near-duplicates.** This is the concrete form of the "autonomous writes need review" concern.

## Proposal
Make the write tool **similarity-aware and two-phase**, with friction in the mechanism (not a manual):

1. On `*_write`, run a similarity check against existing records (start with the existing FTS/BM25 `findNearDuplicates`; upgrade to **semantic similarity** via embeddings for recall on paraphrases).
2. **If no near-duplicates** → write directly; mark the record `confirmed` (high-confidence, nothing to reconcile).
3. **If near-duplicates found** → **do NOT write blindly.** Return the candidate matches and a token/handle, and require a **second `*_write` round-trip with `confirm: <handle>`** (or an explicit `on_conflict` choice: update target / supersede / write-anyway). The first call is a no-op preview; the second commits. The record lands `proposed` until that reconciliation is explicit.

This converts the current *post-hoc* `near_duplicate_warning` (which the pilot shows agents ignore) into a *gate* that forces the supersede-vs-duplicate decision the models skip.

## Why this shape
- **Auto-confirm when safe** keeps the common path frictionless (no near-dups = no extra round-trip).
- **Confirm-submit when risky** injects exactly one speedbump where pollution happens, and surfaces the existing record so "update instead of duplicate" becomes the easy choice.
- Mechanism-level friction, minimal manual — consistent with the project's high-affordance/minimalism principle.
- Pairs with the `proposed → confirmed` status: similarity-clean writes can auto-`confirmed`; conflicted writes stay `proposed` for the batched review ritual.

## Open questions
- Similarity threshold + which signal (FTS BM25 vs embeddings vs hybrid); embeddings add a model dependency + cost.
- Where the `confirm` handle lives (ephemeral server-side cache keyed by content hash).
- Whether to also gate `*_write` to an existing `(namespace, key)` (the update path) the same way, or only new-key writes.
- Measure it: re-run the T3 contradiction probe with the gate on — does supersede rate rise from 0?

## Related
`[[memory-fs-autonomous-writes-need-review]]` · `[[memory-fs-high-affordance-minimalism]]` · lab note H6.
