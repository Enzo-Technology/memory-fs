# Memory-fs evaluation harness

Validates whether Claude Haiku 4.5 reaches for memory-fs tools at the right times,
given only the tool descriptions and a system prompt.

## Methodology

- **25 prompts × 5 categories × 5 runs = 125 calls per system-prompt variant**
- **3 variants** (A=minimal, B=usage-hints, C=meta-instruction) → 375 calls per regime
- **2 regimes** (memory-fs alone; memory-fs mixed with ~30 distractor tools from filesystem + github + slack MCP servers) → 750 calls total
- Temperature 1.0 (matches τ-bench convention; pass^5 captures reliability)

## Setup

1. Build the server: `npm run build`
2. Set `ANTHROPIC_API_KEY` in your shell.
3. Run the scripted harness: `node eval/run-eval.mjs` (see Task 11 in the plan).

**MCPJam Inspector** is an optional fallback for visual inspection of individual cells before running the full 750:

1. `npx -y @mcpjam/inspector`
2. Add this server as a local stdio MCP server: command `node`, args `["./dist/index.js"]`, env `MEMORY_FS_DB=/tmp/memfs-eval.db`.
3. Paste the contents of `eval/system-prompts/<variant>.md` into MCPJam's system-prompt field, then a prompt from `eval/prompts.json`, and send (model `claude-haiku-4-5`, temp 1.0).
4. Use MCPJam to sanity-check 10–20 cells; use the scripted harness for the full eval.

## Random tool order

For each run, **randomize the order tools appear in the system prompt** (BFCL found this matters several points). The scripted harness does this automatically.

## Scoring

See `scoring-rubric.md`. Score each trace on six dimensions; report selection accuracy, implicit-trigger rate, false-positive rate, and pass^5.

## Anti-eval-awareness

- Do **not** include the word "evaluation", "test", "experiment", "benchmark" in the system prompt.
- Use realistic Enzo-flavored content; avoid round numbers of options or obviously synthetic phrasing.
- Strip "recall", "remember", "memory" verbs from implicit-category prompts.

## Reporting

After all 750 calls, write a results file `eval/results/SUMMARY.md` with:
- A 3×5 table per regime: variant × category → selection accuracy
- False-positive rate per variant (distractor category)
- pass^5 per variant
- 5 example traces where Haiku made a surprising tool choice
- A verdict: which variant ships?
