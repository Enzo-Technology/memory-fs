# memory-fs: local-only web UI (browse / read / delete)

**Goal:** A small web interface, run locally on a laptop, to browse, read, and delete memories in the hosted shared store at `https://memory.enzotech.io/`. The browser only ever talks to `localhost`; the bearer token stays server-side in the local proxy and is never sent to the browser.

**Architecture:** A local Node proxy (`src/ui-server.ts`) binds `127.0.0.1:<port>`, holds `MEMORY_FS_TOKEN` from its own environment, and connects to the remote store via the MCP SDK client (`StreamableHTTPClientTransport`, server-side → no CORS). It serves one static HTML page plus a few JSON endpoints that map 1:1 to existing MCP tools (`memory_browse`, `memory_read`, `memory_backlinks`, `memory_delete`). No new server-side capabilities — it's a thin proxy over tools that already exist.

**Why a proxy (not a static page hitting the host directly):** the hosted endpoint speaks MCP streaming (JSON-RPC + SSE) and sends no CORS headers, and we don't want the bearer token in browser JS. The proxy solves all three.

**Scope:** browse, read, delete only. **No write/edit** (memories are still authored by agents via `memory_note`). Delete honors the server's backlink-protection check, with an explicit force toggle in the UI.

**Tech:** reuse existing deps (`@modelcontextprotocol/sdk`, `node:http`). No frontend framework, no build step for the page — plain HTML + vanilla JS in `public/index.html`. Tests via vitest, exercised against a *local* HTTP instance of the server (the same HTTP mode added in Phase 5), not the live host.

**Out of scope:** auth on the local side (it's localhost-only, single user), search/recall UI, editing, multi-store switching.

---

## File structure

**Create:**
- `src/ui-server.ts` — local proxy server (env config, MCP client, static + JSON endpoints, 127.0.0.1 bind).
- `public/index.html` — single-page browse/read/delete UI (vanilla HTML+JS).
- `tests/ui-server.test.ts` — integration test against a locally-spawned HTTP memory server.

**Modify:**
- `package.json` — add `"ui": "node dist/ui-server.js"` and `"ui:dev": "tsx src/ui-server.ts"`.
- `README.md` — a short "Local web UI" usage section.

---

## Tasks

### Task 1: Local proxy server + JSON API (TDD)

**Files:** create `src/ui-server.ts`, `tests/ui-server.test.ts`; modify `package.json`.

- [ ] **Write failing test** `tests/ui-server.test.ts`:
  - Spawn `dist/server.js` in HTTP mode (`MEMORY_FS_HTTP_PORT`, `MEMORY_FS_TOKEN=secret`, tmp `MEMORY_FS_DB`) — the store under test.
  - Seed one record by connecting an MCP client and calling `memory_note` (the UI itself can't write).
  - Start the UI proxy (`MEMORY_FS_URL=http://127.0.0.1:<storePort>`, `MEMORY_FS_TOKEN=secret`, `MEMORY_FS_UI_PORT=<free>`).
  - Assert: `GET /api/browse?kind=recent` returns JSON including the seeded key; `GET /api/read?namespace=&key=` returns its content; `GET /` returns HTML (200, `text/html`); `POST /api/delete` removes it (and a follow-up read 404s/empty).
- [ ] **Implement `src/ui-server.ts`:**
  - Read env: `MEMORY_FS_URL` (required; e.g. `https://memory.enzotech.io/`), `MEMORY_FS_TOKEN` (required — exit with a clear message if missing, same fail-fast as the main server), `MEMORY_FS_UI_PORT` (default 4040).
  - Helper that runs one MCP call against the remote: connect a `Client` via `StreamableHTTPClientTransport(new URL(MEMORY_FS_URL), { requestInit: { headers: { Authorization: \`Bearer ${token}\` } } })`, call the tool, close. (Per-request connect is fine — the host is stateless. Reuse later only if it proves slow.)
  - `node:http` server bound to `127.0.0.1` only. Routes:
    - `GET /` → serve `public/index.html` (read via `join(import.meta.dirname, "../public/index.html")`).
    - `GET /api/browse` → `memory_browse` (pass through `kind`, `namespace`, `prefix`, `limit`).
    - `GET /api/read` → `memory_read` (`namespace`, `key`).
    - `GET /api/backlinks` → `memory_backlinks` (`namespace`, `key`).
    - `POST /api/delete` (JSON body `{namespace, key, force}`) → `memory_delete`; return the tool result (including the backlink-protection error when force is false) with a sensible HTTP status.
    - Anything else → 404.
  - Each `/api/*` response is JSON; on a tool/transport error, return `{error: message}` with status 502 and never crash the process.
  - Log startup: `[memory-fs-ui] serving on http://127.0.0.1:<port> -> <MEMORY_FS_URL>`.
  - Add the two npm scripts.
- [ ] **Verify:** `npx tsc` clean; `npm test -- ui-server` green; full `npm test` green. Commit `feat: local web UI proxy server + JSON API`.

### Task 2: The web page

**Files:** create `public/index.html`.

- [ ] Single page, vanilla JS, talks only to its own origin (`/api/*`). Layout:
  - **Left:** controls — a `kind` selector (recent / index / hubs / orphans / tags), optional namespace + prefix filters, refresh; renders the resulting list (key, namespace, type, and in-degree for hubs / count for tags).
  - **Right:** on selecting an item, fetch `/api/read` and show full content (render markdown lightly or as preformatted text), metadata, tags, and its backlinks (`/api/backlinks`).
  - **Delete:** a button on the detail pane → confirm dialog → `POST /api/delete`. If the server refuses due to backlinks, show the message and reveal a "Delete anyway (force)" affordance that re-sends with `force:true`. Refresh the list on success.
  - Minimal, legible styling (system font, simple two-column layout). No external CDNs.
- [ ] **Verify (manual):** `npm run build && npm run ui` with env pointed at the live store; open `http://127.0.0.1:4040`, confirm browse/read/delete work (e.g. delete the `project:enzo/deploy-smoke` test record). Capture a screenshot for the PR/commit. Commit `feat: local web UI page`.

### Task 3: Docs

**Files:** modify `README.md`.

- [ ] Add a "Local web UI" section: what it is (local-only, talks to the hosted store with your bearer token), the env vars (`MEMORY_FS_URL`, `MEMORY_FS_TOKEN`, `MEMORY_FS_UI_PORT`), and the run command (`npm run build && npm run ui`). One sentence that the token never reaches the browser. Commit `docs: local web UI usage`.

---

## Verification
1. `npm test` green incl. `tests/ui-server.test.ts`.
2. `npm run ui` against `https://memory.enzotech.io/` lists real records, opens one, and deletes a record (respecting + overriding backlink protection).
3. The browser never receives the bearer token (it's only in the proxy's env; confirm the page source / network tab carries no token).
