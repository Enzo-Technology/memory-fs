# Scoring rubric

For each trace (one Haiku response to one prompt), score these binary/ordinal dimensions:

| Dimension | Score | Definition |
|---|---|---|
| Tool selection | 0/1 | Did Haiku pick the right tool from the 7? |
| Triggered when appropriate | 0/1 | For implicit categories (recall/write) — did it fire without being told? |
| False positive | 0/1 (inverted) | Did it call a memory tool in the distractor category? Lower is better — record as 1 = good (no fp), 0 = bad (fp occurred). |
| Parameter correctness | 0/1/2 | 0 = hallucinated args, 1 = partial, 2 = clean |
| Call ordering | 0/1 | Multi-step only — recall-before-write, etc. |

Then per prompt, compute pass^5 = (# of 5 runs that scored 1 on the primary metric for that category) / 5.

Headline metrics to report:
- **Selection accuracy** — % of trials where the right tool was chosen
- **Implicit-trigger rate** — % of trials in categories `implicit_recall` + `implicit_write` where the tool fired without explicit instruction
- **False-positive rate** — % of trials in `distractor` where a memory_ tool fired (lower is better)
- **pass^5** — fraction of prompts where all 5 runs got tool selection right
