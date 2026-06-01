---
name: using-memory-fs
description: Read and write the team's SHARED memory store (the memory-fs MCP server) so context persists across agents, machines, and sessions. Use when the user references prior decisions, projects, or deadlines you weren't told this session, states something durable worth remembering for the team, or asks to recall/forget shared context. Distinct from local single-agent session memory.
---

# Using memory-fs (shared memory)

memory-fs is a **shared** memory store exposed over MCP (SQLite + FTS5). Unlike a single
agent's local session memory, everything here is visible to **all agents, machines, and
teammates**. Treat it as the team's collective long-term memory.

Tools: `memory_note`, `memory_recall`, `memory_browse`, `memory_read`, `memory_delete`,
`memory_link`, `memory_backlinks`.

## Shared vs. local memory

- **Use memory-fs** for anything another agent, machine, or teammate would benefit from:
  team decisions, project facts, durable user preferences, references to external systems.
- **Don't** use it for ephemeral, single-session task state — keep that local or in your
  working context. If it only matters for this conversation, it doesn't belong here.

## Recall before you write

Before writing, `memory_recall` the topic first. If a close record exists, **update it**
(re-`memory_note` the same namespace+key) rather than creating a near-duplicate.
`memory_note` warns on near-duplicates — don't ignore the warning.

## Writing (`memory_note`)

- **Namespace** = logical scope: `user`, `project:<name>` (e.g. `project:enzo`),
  `agent:<role>`. Pick the broadest scope the fact is true in.
- **type** = `user` | `feedback` | `project` | `reference` | `note`. Match the content.
- **Link** related records with `[[wikilinks]]` in the body — these auto-extract into the
  backlink graph. Prefer this over `memory_link`; reserve `memory_link` for relationships
  you can't phrase as a wikilink (e.g. `supersedes`, `caused-by`).
- **tags** = freeform labels for later filtering.
- **Never** store secrets, credentials, or PII.

## Reading

- `memory_recall <query>` — search by relevance (FTS5: phrases, `AND`/`OR`, `prefix*`).
- `memory_browse kind=...` — no query: `index` (overview), `recent`, `hubs` (most-linked,
  usually most important), `orphans` (often stale), `tags` (vocabulary). Also use `browse`
  to filter by tag or namespace.
- `memory_backlinks` — what references a record; often the fastest way to understand a topic.
- `memory_read namespace key` — fetch one record when you already have its exact key.

## Deleting

`memory_delete` only when the user asks to forget something or a record is clearly wrong.
It refuses if other records link to the target; prefer updating over force-deleting.

## Setup

The server ships with the repo. Build and register it with your MCP client:

```sh
npm install && npm run build
node dist/server.js        # stdio transport
```

- DB defaults to `~/.memory-fs/memory.db`; override with `MEMORY_FS_DB=/path/to/db`.
- For a shared store, point every client's `MEMORY_FS_DB` at the same database, or run the
  optional HTTP transport (`MEMORY_FS_HTTP_PORT` + `MEMORY_FS_TOKEN`) and connect clients to it.
- Register `node /abs/path/dist/server.js` as an MCP server in your client (Claude Code,
  Cursor, etc.).
