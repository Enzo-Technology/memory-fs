# RESULTS — tool-wording experiment

> **Interpretation note:** Risk differences are the headline; null here means
> 'no large effect detected', NOT equivalence. Confidence intervals are Wilson
> 95% CIs; risk-difference CIs use the Newcombe method.

## Per-(condition × model) rate table

| condition | model | m1 unprompted-read (T1) | m4 trivia-write (T4) | m5 deposit-rate (T5) | m6 spurious-write (P3b) | m7b tidy-deploy-smoke (P3b) | m3a scoped-read (T3) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C | openai | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 80% [38%–96%] (n=5) | 20% [4%–62%] (n=5) |
| C | sonnet | 0% [0%–43%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) |
| M | openai | 20% [4%–62%] (n=5) | 60% [23%–88%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 20% [4%–62%] (n=5) |
| M | sonnet | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 20% [4%–62%] (n=5) |

### m3b update-behaviour (T3)

| condition | model | update | duplicate | none | n |
| --- | --- | --- | --- | --- | --- |
| C | openai | 0 | 5 | 0 | 5 |
| C | sonnet | 0 | 5 | 0 | 5 |
| M | openai | 0 | 5 | 0 | 5 |
| M | sonnet | 0 | 5 | 0 | 5 |

## Preregistered comparisons

### H1 — Memory stores trivia more than Context (m4/T4)
> Predicted ≥ 20pp M > C.

- **openai**: RD = 60pp [3, 88] (M minus C)
- **sonnet**: RD = 100pp [39, 100] (M minus C)

### H2 — Context reads more at cold start (m1/T1)
> Predicted ≥ 10pp C > M.

- **openai**: RD = 80pp [19, 96] (C minus M)
- **sonnet**: RD = 0pp [-43, 43] (C minus M)

## Provider comparison (M−C gap)

- **trivia m4/T4**: openai: 60pp vs sonnet: 100pp
- **cold-read m1/T1**: openai: -80pp vs sonnet: 0pp

---

## How to reproduce

```sh
npm run eval:score    # re-score transcripts → eval/artifacts/scores.json
npm run eval:analyze  # compute CIs + risk differences → RESULTS.md
npm run eval:charts   # render SVG charts → eval/charts/
```

> All numbers regenerate deterministically from `eval/artifacts/scores.json`.