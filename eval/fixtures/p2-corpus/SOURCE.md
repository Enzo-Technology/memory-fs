# Corpus Source Attribution

## Dataset

**Name:** CodeChat  
**Authors:** Suzhen (HuggingFace user)  
**URL:** https://huggingface.co/datasets/Suzhen/CodeChat  
**License:** ODC-BY (Open Data Commons Attribution License)

## Sampling

Fetched via the HuggingFace datasets-server public HTTP API (no authentication required):

```
https://datasets-server.huggingface.co/rows?dataset=Suzhen/CodeChat&config=default&split=train&offset=<N>&length=100
```

**Config:** `default`  
**Split:** `train`  
**Offsets fetched:** 0, 100, 200, 300 (400 rows total scanned)

### Source row IDs (row_idx in the datasets-server response)

| File     | Source row_idx | Turns | Topic                              |
|----------|---------------|-------|------------------------------------|
| 000.json | 10            | 14    | Node.js server code review         |
| 001.json | 51            | 10    | GLSL shader specular highlight     |
| 002.json | 17            | 14    | Two's-complement encoding (CS fundamentals)|
| 003.json | 86            | 12    | ASP.NET Core routing/endpoints     |
| 004.json | 107           | 12    | PostgreSQL JSON aggregation queries|
| 005.json | 169           | 14    | Ruby formula / Workato scripting   |
| 006.json | 186           | 14    | CSS button press effect            |
| 007.json | 114           | 12    | PostgreSQL ad-group query grouping |
| 008.json | 228           | 14    | Mongoose → Postgres schema migration|
| 009.json | 253           | 14    | Node.js HTTPS response formatting  |
| 010.json | 300           | 12    | C++ wxWidgets class instantiation  |
| 011.json | 330           | 12    | C# Unity ball color change script  |

## Selection criteria

- English only (all messages)
- 8–14 turns per file (longer sessions trimmed to a coherent prefix; must start user / alternate user↔assistant)
- Software-engineering working-session content (coding, debugging, design)
- No tool-call structures (tool_use, tool_result, function_call)
- No heavy PII (email addresses, API keys); generic example emails excluded

## Priming-control scrubbing

Three nouns were replaced throughout all files to prevent priming in the P2 wording experiment:

| Original   | Replacement | Rule                                          |
|------------|-------------|-----------------------------------------------|
| `memory`   | `RAM`       | Case-insensitive whole-word; e.g. "RAM leak"  |
| `context`  | `setup`     | Case-insensitive whole-word                   |
| `knowledge`| `understanding` | Case-insensitive whole-word              |

Tool-name fragments `_write`, `_read`, `_search`, `_browse`, `_link`, `_backlinks`, `_delete` were also removed (word-boundary match).

Rows were dropped if banned words appeared as code identifiers so frequently that scrubbing would mangle the technical content.

## Rows dropped during screening

400 rows were scanned. The dominant drop reasons were:
- Non-English (229 rows)
- Too few alternating turns (110 rows)
- Too many banned-word occurrences / code identifiers (3 rows)
- Non-SW content (image generation, roleplay, pure Q&A) — several rows

PII screening: no real email addresses or secrets were found in the 12 retained sessions.

Two initially-selected rows (row_idx 58 and 205) were subsequently dropped because the word "Context" appeared as a code identifier (e.g., `ApplicationDbContext`, `@PersistenceContext`) within code blocks; scrubbing those would have mangled the technical content. They were replaced by rows 17 and 114.
