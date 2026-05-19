# memory-fs

A shared memory filesystem for AI agents, exposed over the [Model Context Protocol](https://modelcontextprotocol.io).

Open-source, self-hosted. Designed to let Claude, Cursor, ChatGPT, and any custom chat agent share persistent memory across sessions, codebases, and machines.

## Status

**Phase 1 prototype.** Local-only stdio MCP server. Wiki-shaped: auto-extracted `[[wikilinks]]`, backlinks, hubs, tag vocabulary. 7-tool surface validated against Claude Haiku 4.5 via an included eval harness. Not yet hosted; transport remains stdio until Phase 5.

See [`docs/plans/2026-05-18-phase-1-wiki-layer-and-eval.md`](docs/plans/2026-05-18-phase-1-wiki-layer-and-eval.md) for the full design.

## Quick start

```sh
npm install
npm run build
node dist/server.js   # stdio MCP server, hit it with any MCP client
```

DB lives at `~/.memory-fs/memory.db` by default; override with `MEMORY_FS_DB=/path/to/db`.

## Tool surface

| Tool | What it does |
|---|---|
| `memory_note` | Write a memory; auto-extracts `[[wikilinks]]`; warns on near-duplicates |
| `memory_recall` | Search memories (FTS5); hub records promoted |
| `memory_browse` | Discovery: `kind=index/recent/hubs/orphans/tags` |
| `memory_read` | Fetch one by `(namespace, key)` |
| `memory_delete` | Permanent delete; refuses if backlinks exist (`force=true` overrides) |
| `memory_link` | Manual link (most links come from auto-extracted `[[wikilinks]]`) |
| `memory_backlinks` | List records that point to a given memory |

## Evaluation

A scripted harness drives the server against Claude Haiku 4.5 across 3 system-prompt variants × 2 tool-regimes × 25 prompts × 5 runs = 750 calls. Set `ANTHROPIC_API_KEY` and:

```sh
node eval/run-eval.mjs
node eval/score.mjs > eval/results/SUMMARY.txt
```

See [`eval/README.md`](eval/README.md).

## Engineering principles

See [`CLAUDE.md`](CLAUDE.md) — bias to no, crash on impossible states, surface gaps, verify before claiming done. Future contributors and agents are expected to read it before writing code.

## License

MIT.
