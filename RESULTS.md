# RESULTS — tool-wording experiment

> **Interpretation note:** Risk differences are the headline; null here means
> 'no large effect detected', NOT equivalence. Confidence intervals are Wilson
> 95% CIs; risk-difference CIs use the Newcombe method.

## Per-(condition × model) rate table

| condition | model | m1 unprompted-read (T1) | m4 trivia-write (T4) | m5 deposit-rate (T5) | m6 spurious-write (P3b) | m7b tidy-deploy-smoke (P3b) | m3a scoped-read (T3) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C | openai | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 80% [38%–96%] (n=5) | 20% [4%–62%] (n=5) |
| C | sonnet | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) |
| CxM | openai | 20% [4%–62%] (n=5) | 80% [38%–96%] (n=5) | 100% [57%–100%] (n=5) | — | — | 0% [0%–43%] (n=5) |
| CxM | sonnet | 100% [57%–100%] (n=5) | 60% [23%–88%] (n=5) | 100% [57%–100%] (n=5) | — | — | 20% [4%–62%] (n=5) |
| K | openai | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | — | — | 20% [4%–62%] (n=5) |
| K | sonnet | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | — | — | 0% [0%–43%] (n=5) |
| M | openai | 20% [4%–62%] (n=5) | 60% [23%–88%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 20% [4%–62%] (n=5) |
| M | sonnet | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 100% [57%–100%] (n=5) | 20% [4%–62%] (n=5) |
| MxC | openai | 100% [57%–100%] (n=5) | 0% [0%–49%] (n=4) | 100% [51%–100%] (n=4) | — | — | 50% [15%–85%] (n=4) |
| MxC | sonnet | 100% [57%–100%] (n=5) | 0% [0%–43%] (n=5) | 100% [57%–100%] (n=5) | — | — | 0% [0%–43%] (n=5) |

### m3b update-behaviour (T3)

| condition | model | update | duplicate | none | n |
| --- | --- | --- | --- | --- | --- |
| C | openai | 0 | 5 | 0 | 5 |
| C | sonnet | 0 | 5 | 0 | 5 |
| CxM | openai | 0 | 5 | 0 | 5 |
| CxM | sonnet | 0 | 5 | 0 | 5 |
| K | openai | 1 | 4 | 0 | 5 |
| K | sonnet | 0 | 5 | 0 | 5 |
| M | openai | 0 | 5 | 0 | 5 |
| M | sonnet | 0 | 5 | 0 | 5 |
| MxC | openai | 2 | 2 | 0 | 4 |
| MxC | sonnet | 0 | 5 | 0 | 5 |

## Preregistered comparisons

### H1 — Memory stores trivia more than Context (m4/T4)
> Predicted ≥ 20pp M > C.

- **openai**: RD = 60pp [3, 88] (M minus C)
- **sonnet**: RD = 100pp [39, 100] (M minus C)

### H2 — Context reads more at cold start (m1/T1)
> Predicted ≥ 10pp C > M.

- **openai**: RD = 80pp [19, 96] (C minus M)
- **sonnet**: RD = 0pp [-43, 43] (C minus M)

### H3 — Keyword condition vs Context on trivia (m4/T4)

- **openai**: RD = 0pp [-43, 43] (K minus C), K deposit rate m5/T5: 100% [57%–100%] (n=5)
- **sonnet**: RD = 0pp [-43, 43] (K minus C), K deposit rate m5/T5: 100% [57%–100%] (n=5)

### H4 — Noun×Description cross conditions
> Verdict: |cross−C| < |cross−M| → behaves like C (description-driven); otherwise noun-driven.

- **CxM/openai** trivia m4/T4: CxM=NaN%, M=NaN%, C=NaN%; vs M: 20pp [-31, 60]; vs C: 80pp [19, 96] → behaves like M (noun-driven)
- **CxM/openai** cold-read m1/T1: CxM=NaN%, M=NaN%, C=NaN%; vs M: 0pp [-45, 45]; vs C: -80pp [-96, -19] → behaves like M (noun-driven)
- **CxM/sonnet** trivia m4/T4: CxM=NaN%, M=NaN%, C=NaN%; vs M: -40pp [-77, 12]; vs C: 60pp [3, 88] → behaves like M (noun-driven)
- **CxM/sonnet** cold-read m1/T1: CxM=NaN%, M=NaN%, C=NaN%; vs M: 0pp [-43, 43]; vs C: 0pp [-43, 43] → behaves like M (noun-driven)
- **MxC/openai** trivia m4/T4: MxC=NaN%, M=NaN%, C=NaN%; vs M: -60pp [-88, 1]; vs C: 0pp [-43, 49] → behaves like C (description-driven)
- **MxC/openai** cold-read m1/T1: MxC=NaN%, M=NaN%, C=NaN%; vs M: 80pp [19, 96]; vs C: 0pp [-43, 43] → behaves like C (description-driven)
- **MxC/sonnet** trivia m4/T4: MxC=NaN%, M=NaN%, C=NaN%; vs M: -100pp [-100, -39]; vs C: 0pp [-43, 43] → behaves like C (description-driven)
- **MxC/sonnet** cold-read m1/T1: MxC=NaN%, M=NaN%, C=NaN%; vs M: 0pp [-43, 43]; vs C: 0pp [-43, 43] → behaves like M (noun-driven)

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