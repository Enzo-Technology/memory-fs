# memory-fs

A shared memory filesystem for AI agents, exposed over the [Model Context Protocol](https://modelcontextprotocol.io).

Open-source, self-hosted. Designed to let Claude, Cursor, ChatGPT, and any custom chat agent share persistent memory across sessions, codebases, and machines.

## Status

**Phase 1 + 5 prototype.** Wiki-shaped MCP server: auto-extracted `[[wikilinks]]`, backlinks, hubs, tag vocabulary. 7-tool surface validated against Claude Haiku 4.5 via an included eval harness. Runs over stdio by default, or over Streamable HTTP with bearer auth for a hosted shared store (see Hosting below).

## Quick start

```sh
npm install
npm run build
node dist/index.js   # stdio MCP server, hit it with any MCP client
```

DB lives at `~/.memory-fs/memory.db` by default; override with `MEMORY_FS_DB=/path/to/db`.

## Tool surface

| Tool | What it does |
|---|---|
| `context_write` | Write a record to the shared context; auto-extracts `[[wikilinks]]`; warns on near-duplicates |
| `context_search` | Search the shared context (FTS5); hub records promoted |
| `context_browse` | Discovery: `kind=index/recent/hubs/orphans/tags` |
| `context_read` | Fetch one by `(namespace, key)` |
| `context_delete` | Permanent delete; refuses if backlinks exist (`force=true` overrides) |
| `context_link` | Manual link (most links come from auto-extracted `[[wikilinks]]`) |
| `context_backlinks` | List records that point to a given record |

## Hosting (shared store)

Set `MEMORY_FS_HTTP_PORT` to serve over Streamable HTTP instead of stdio; `MEMORY_FS_TOKEN` is then required and every request must send `Authorization: Bearer <token>`. The server binds `127.0.0.1`, so run it behind a TLS-terminating reverse proxy (the included [`deploy/`](deploy/) has a Caddy config, systemd units, and a GCS backup timer for a single free-tier VM). Full runbook: [`deploy/README.md`](deploy/README.md).

## Local web UI

A local-only page to browse, read, and delete records in a hosted store. It runs a small proxy on your machine that holds the bearer token server-side and talks to the remote over MCP — **the token never reaches the browser**, and the browser only ever talks to `localhost`.

```sh
npm run build
MEMORY_FS_URL=https://your-host.example.com/ \
MEMORY_FS_TOKEN=<your-bearer-token> \
MEMORY_FS_UI_PORT=4040 \
npm run ui
# then open http://127.0.0.1:4040
```

`MEMORY_FS_UI_PORT` defaults to 4040. Scope is browse/read/delete only — memories are still authored by agents via `context_write`.

To keep the token out of your shell, store `MEMORY_FS_URL` and `MEMORY_FS_TOKEN` in [Infisical](https://infisical.com) and run `npm run ui:secure` (`infisical run -- node dist/ui-server.js`) — it injects the secrets as env vars. Requires `infisical login` + `infisical init` once to link the project; pass `--env=<name>` to `infisical run` to pick a non-default environment.

## Companion skill

[`skills/using-memory-fs/`](skills/using-memory-fs/SKILL.md) is an Agent Skill that teaches an agent the *policy* for this server — when to use shared memory vs. local session memory, recall-before-write, namespace/tag/linking conventions, and setup. Tool descriptions stay lean (always in context); the skill carries the heavier guidance and loads only when relevant.

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

[AGPL-3.0](LICENSE). © 2026 Enzo Technology, Inc.

memory-fs is free to self-host. The AGPL's network-use clause means anyone who
offers it as a service must publish their modifications. A separate commercial
license is available for the hosted offering.
