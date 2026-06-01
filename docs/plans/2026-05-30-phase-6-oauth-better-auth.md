# memory-fs Phase 6: OAuth via Better Auth (in-process AS+RS + per-user identity)

> ⚠️ **SUPERSEDED (2026-06-01)** by [`2026-06-01-phase-6-oauth-and-frontend.md`](./2026-06-01-phase-6-oauth-and-frontend.md).
> This doc's auth design was **abandoned**: the shipped version **removes** the static
> `MEMORY_FS_TOKEN` dual-auth path and verifies bearers locally via `jose`/JWKS (see
> ADR-0001), rather than the static-token + `mcpHandler` approach described below. Kept for
> history; do not implement from this doc.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OAuth 2.1 to the live hosted server at `https://memory.enzotech.io` so it's addable from Claude.ai web + mobile (which only accept OAuth or no-auth) and any other connector-style client, while keeping the existing static `Authorization: Bearer <MEMORY_FS_TOKEN>` working for Claude Code / Cursor / CLI clients. Use **Better Auth `@better-auth/oauth-provider`** in-process (AS + RS share the Node process and the existing SQLite). Deliver per-user identity along with it (memories namespaced by `userId`).

**Architecture (locked in prior research, see memory `memory-fs-hosted-shared-store`):**
- One Node process. Better Auth runs in-process as the **Authorization Server**; memory-fs's existing `StreamableHTTPServerTransport` route is the **Resource Server**.
- One SQLite file (`~/.memory-fs/memory.db` in dev, `/var/lib/memory-fs/memory.db` in prod). Better Auth owns its own tables (`user`, `session`, `account`, `verification`, `jwks`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`) alongside the existing `memories`/`links`/`tags`/FTS5 tables.
- **Dual auth on the MCP route:** request handler first checks for the static `MEMORY_FS_TOKEN` (legacy path, maps to a synthetic shared identity); otherwise delegates to Better Auth's `mcpHandler` (JWT verified locally via JWKS, audience-bound, returns `401 + WWW-Authenticate` to bootstrap OAuth discovery).
- Behind the existing Caddy on the VM; TLS unchanged; `MEMORY_FS_DOMAIN=memory.enzotech.io` so issuer = `https://memory.enzotech.io/api/auth`.

**Locked decisions (do NOT re-litigate in this plan):**
- Library: `better-auth` + `@better-auth/oauth-provider`, **pinned ≥ 1.6.11** (≥1.6.5 minimum for the security fix; track stable thereafter). The NEW `oauth-provider` plugin only — not the deprecated `mcp` plugin.
- DCR: `allowDynamicClientRegistration: true` and `allowUnauthenticatedClientRegistration: true` (Claude needs both).
- PKCE: S256 only (Better Auth default; do not loosen).
- Identity: email/password initially (single-team, self-host). Social login deferred to Phase 6.1.
- Keep static bearer indefinitely for CLI/script clients.
- Spike at `prototype/oauth-spike/` already validated the protocol surface locally (discovery, DCR, 401+WWW-Authenticate, JWKS). Its `auth.ts` / `server.ts` are the reference; this plan integrates the validated wiring into `src/server.ts`.

**Tech stack delta:** `better-auth`, `@better-auth/oauth-provider`. No new HTTP framework — keep `node:http` + the SDK's `StreamableHTTPServerTransport`; mount Better Auth via the SDK's documented Node helper (`toNodeHandler` from `better-auth/node`).

**Out of scope (defer):**
- Social login providers, magic links, passkeys (Phase 6.1).
- CIMD (not yet implemented in Better Auth; DCR satisfies Claude today).
- Migrating EXISTING shared-token memories to specific users (one-time data migration, separate ticket if anyone has authored notes under the shared identity).
- Publishing to the official MCP Registry (separate ticket, registry is pre-GA).

---

## File structure

**Modify:**
- `src/server.ts` — mount Better Auth handler at `/api/auth/*`, add discovery routes (PRM + AS metadata at root + issuer-path form), wrap the existing MCP route with dual-auth (static bearer OR Better Auth `mcpHandler`), thread `userId` into store calls.
- `src/store.ts` — accept an optional `actor` (user id + display) on write paths and on `recall`/`browse` filter; default `actor.namespace` becomes the effective namespace when caller omits one. Do NOT silently rewrite explicit caller namespaces.
- `src/db.ts` — no schema change for memory-fs tables; ensure WAL + busy_timeout + foreign_keys settings remain compatible with Better Auth's concurrent reads (Better Auth opens its own better-sqlite3 connection on the same file).
- `package.json` — add `better-auth`, `@better-auth/oauth-provider` to deps; add `"auth:migrate": "npx @better-auth/cli@latest migrate --config src/auth.ts -y"`.
- `deploy/memory-fs.service` — add required env vars (`BETTER_AUTH_SECRET`, `MEMORY_FS_DOMAIN` → used as baseURL).
- `deploy/Caddyfile` — no change expected; Caddy already terminates TLS and proxies to the Node port.
- `README.md` — short "OAuth (claude.ai/mobile)" section pointing at the connector URL + that the shared bearer still works.

**Create:**
- `src/auth.ts` — `betterAuth({...})` config; export `auth` and `BASE_URL`.
- `src/login.ts` — minimal server-rendered HTML for `/sign-in` and `/consent` (string templates, no framework, escape inputs).
- `tests/oauth.test.ts` — protocol-surface smoke (PRM JSON shape, AS metadata reachable at both well-known paths, 401+WWW-Authenticate on `/mcp` with no token, DCR `POST /api/auth/oauth2/register` returns a `client_id`, static-bearer path still returns the 7 tools).
- `docs/adr/0001-oauth-better-auth-in-process.md` — short ADR capturing the locked decisions above for future readers.

---

## Tasks

### Task 1 — Add Better Auth deps + schema migration

**Files:** `package.json`, generated SQL.

- [ ] `npm install better-auth@^1.6.11 @better-auth/oauth-provider@^1.6.11`. Verify both resolve to ≥1.6.11.
- [ ] Add scripts:
  ```json
  "auth:migrate": "npx @better-auth/cli@latest migrate --config src/auth.ts -y",
  "auth:generate": "npx @better-auth/cli@latest generate --config src/auth.ts -y"
  ```
- [ ] Stub `src/auth.ts` with the minimal config from Task 2 step 1 so the CLI can introspect it, then run `npm run auth:migrate` against a fresh dev DB. Confirm the migration creates `user`, `session`, `account`, `verification`, `jwks`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` and does NOT touch the existing memory-fs tables.
- [ ] Commit: `chore: add better-auth + oauth-provider deps + migration script`.

### Task 2 — `src/auth.ts`

**Files:** create `src/auth.ts`.

- [ ] Step 1 — write the config. Reference shape (matches `prototype/oauth-spike/auth.ts` which is already validated):
  ```ts
  import { betterAuth } from "better-auth";
  import { jwt } from "better-auth/plugins";
  import { oauthProvider } from "@better-auth/oauth-provider";
  import Database from "better-sqlite3";

  export const BASE_URL = process.env.MEMORY_FS_BASE_URL
    ?? `https://${process.env.MEMORY_FS_DOMAIN}`
    ?? "http://localhost:8787";

  if (!process.env.BETTER_AUTH_SECRET) {
    console.error("[memory-fs] BETTER_AUTH_SECRET is required when OAuth is enabled");
    process.exit(1);
  }

  export const auth = betterAuth({
    database: new Database(process.env.MEMORY_FS_DB!),  // same DB file as memory-fs
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL: BASE_URL,
    trustedOrigins: ["https://claude.ai", "https://claude.com", BASE_URL],
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
  });
  ```
- [ ] Step 2 — fail-fast guards (boundary validation, per CLAUDE.md "validate at boundaries"). The startup check above must run BEFORE `betterAuth()` so a missing secret produces a clean error, not a cryptic crash inside the library.
- [ ] Step 3 — confirm `npx tsc --noEmit` clean.
- [ ] Commit: `feat: src/auth.ts — Better Auth in-process AS config`.

### Task 3 — Dual-auth middleware + discovery + mount in `src/server.ts`

**Files:** modify `src/server.ts`.

This is the integration task. Five sub-steps, all in one file.

- [ ] **3a — Mount Better Auth handler.** Before the existing `StreamableHTTPServerTransport` registration, route any request whose URL starts with `/api/auth/` to Better Auth via `toNodeHandler(auth)` from `better-auth/node`. The Better Auth handler covers `/oauth2/authorize|token|register|consent|introspect|revoke`, `/sign-in/email`, `/sign-up/email`, `/jwks`, and the session endpoints.

- [ ] **3b — Discovery routes at root AND issuer-path.** Because Better Auth's issuer carries the `/api/auth` basePath, mount the AS + OIDC metadata helpers at BOTH `/.well-known/<doc>` and `/.well-known/<doc>/api/auth` (+ `/api/auth/.well-known/openid-configuration`). PRM is hand-built JSON (5 fields) returning `authorization_servers: [\`${BASE_URL}/api/auth\`]` and `resource: BASE_URL`. Use the helpers `oauthProviderAuthServerMetadata(auth)` and `oauthProviderOpenIdConfigMetadata(auth)` — they return `(request: Request) => Promise<Response>`.

- [ ] **3c — Dual-auth wrapper on `/mcp`.** Replace the bearer check that currently lives in the MCP route with this order:
  1. If `Authorization: Bearer <token>` equals `MEMORY_FS_TOKEN` (legacy static path) → set `actor = { id: "shared", source: "static" }`, hand off to the existing MCP transport.
  2. Otherwise → delegate to `mcpHandler({ verifyOptions: { issuer: \`${BASE_URL}/api/auth\`, audience: BASE_URL }, jwksUrl: \`${BASE_URL}/api/auth/jwks\` }, async (req, jwt) => { ... })`. Inside the callback, `actor = { id: jwt.sub, source: "oauth" }`, hand off to the existing MCP transport.
  3. If `MEMORY_FS_TOKEN` is unset (OAuth-only mode), skip step 1.
  
  `mcpHandler` already returns `401 + WWW-Authenticate: Bearer resource_metadata="…"` when no JWT is present, which is exactly the bootstrap path Claude needs.

- [ ] **3d — Thread `actor` into store calls.** The MCP transport handlers currently call `store.note(...)`, `store.recall(...)`, etc. with caller-provided args. Add an `actor` parameter to those and pass it through. Defer the actual store-side behavior to Task 4 — for now just plumbing.

- [ ] **3e — Minimal `/sign-in` and `/consent` routes.** Serve the templates from `src/login.ts` (Task 5). For now stub them as 200 text so server-boot tests pass; real HTML comes in Task 5.

- [ ] Verify: `npm test` green, `npx tsc` clean. Confirm by curl against a local instance with `MEMORY_FS_TOKEN=x`, `BETTER_AUTH_SECRET=...`, `MEMORY_FS_BASE_URL=http://localhost:8787`:
  ```
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/.well-known/oauth-protected-resource          # 200
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/.well-known/oauth-authorization-server/api/auth # 200
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/mcp -H "content-type: application/json" -d '{}'   # 401
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/mcp -H "Authorization: Bearer x"               # serves MCP (200/4xx by MCP not auth)
  ```
- [ ] Commit: `feat: server dual-auth — static bearer OR Better Auth JWT + discovery routes`.

### Task 4 — Per-user namespacing in `src/store.ts`

**Files:** modify `src/store.ts`.

The simplest defensible policy: every authenticated `actor` gets a default namespace `user:<id>`. Callers can still pass an explicit `namespace` and that wins (a user MAY write to shared/team namespaces by being explicit). This is additive — no migration of existing rows needed.

- [ ] Step 1 — extend `note`/`recall`/`browse`/`read`/`del`/`backlinks`/`link` signatures to accept an optional `actor: { id: string; source: "static" | "oauth" }`.
- [ ] Step 2 — in `note()`: if `input.namespace` is omitted AND `actor` is present, default to `user:${actor.id}`. If `actor.source === "static"` use `shared` (preserves the current behavior for legacy clients). If both `input.namespace` and `actor` are present, use `input.namespace` unchanged — do NOT prefix or rewrite.
- [ ] Step 3 — in `recall`/`browse`: if no `namespace` filter is provided AND `actor.source === "oauth"`, default the filter to `user:${actor.id}`. Static-bearer actors keep current "all namespaces visible" behavior to avoid breaking the eval harness / Claude Code config.
- [ ] Step 4 — `read`/`del`/`link`/`backlinks` take an explicit (namespace, key); no defaulting. They still respect whatever namespace the caller passes.
- [ ] Step 5 — tests in `tests/store.test.ts`: write with `actor={id:"u1",source:"oauth"}` and no namespace → row has `namespace="user:u1"`. Write with `actor={id:"u1"}` AND explicit `namespace="team"` → row has `namespace="team"`. Recall with `actor={id:"u1",source:"oauth"}` and no namespace filter → returns only `user:u1` rows. Static actor unchanged.
- [ ] Verify: `npx tsc` clean, `npm test` green.
- [ ] Commit: `feat: per-user namespacing in store; static-bearer behavior preserved`.

### Task 5 — Login + consent pages

**Files:** create `src/login.ts`; route from `src/server.ts` (Task 3e).

- [ ] Step 1 — `src/login.ts` exports `SIGN_IN_HTML` and `CONSENT_HTML` string constants (template-literal HTML, no framework). Patterns are validated in `prototype/oauth-spike/server.ts`; port them. Requirements:
  - **Sign-in:** email + password form; on submit `fetch("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({email, password}) })`; on success `location.href = "/api/auth/oauth2/authorize" + location.search` to resume the signed authorize request.
  - **Consent:** reads `client_id`, `scope` from query; Allow button `POST /api/auth/oauth2/consent` with `{accept:true}`; Deny with `{accept:false}`; on response follow `redirectURI`/`redirect`/`url` field or `response.url` if redirected.
  - Escape any value interpolated from query params (`client_id`, `scope`) — these are attacker-controlled in the worst case.
- [ ] Step 2 — wire the routes in `src/server.ts` (Task 3e replaces the stubs).
- [ ] Step 3 — smoke locally: visit `/sign-in` and `/consent?client_id=x&scope=openid`. Both render.
- [ ] Commit: `feat: minimal sign-in + consent pages for OAuth flow`.

### Task 6 — Tests

**Files:** create `tests/oauth.test.ts`.

- [ ] Spawn `dist/server.js` with `BETTER_AUTH_SECRET=test-secret-32-bytes-min-length-aaaaaaaaaaaa`, `MEMORY_FS_TOKEN=test-bearer`, `MEMORY_FS_DB=<tmp>`, `MEMORY_FS_BASE_URL=http://127.0.0.1:<port>`. Reuse the spawn pattern in `tests/server.http.test.ts`.
- [ ] Assert:
  1. `GET /.well-known/oauth-protected-resource` → 200, JSON has `resource`, `authorization_servers` containing `…/api/auth`.
  2. `GET /.well-known/oauth-authorization-server/api/auth` → 200, JSON has `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `jwks_uri`.
  3. `POST /mcp` no Authorization → 401, `WWW-Authenticate` starts with `Bearer ` and contains `resource_metadata=`.
  4. `POST /api/auth/oauth2/register` with `{redirect_uris:["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method:"none", grant_types:["authorization_code","refresh_token"], response_types:["code"]}` → 200 with `client_id`.
  5. `POST /mcp` with `Authorization: Bearer test-bearer` (static path) → MCP initialize round-trip + tools/list returns the 7 tool names (same as `tests/server.http.test.ts`).
- [ ] Verify: `npm test` green. Existing tests stay green.
- [ ] Commit: `test: oauth protocol-surface smoke; static-bearer regression`.

### Task 7 — Deploy

**Files:** modify `deploy/memory-fs.service`; update `/etc/memory-fs/env` on the VM; one-time CLI step on the VM to migrate the schema.

- [ ] **7a — VM env**: generate a strong `BETTER_AUTH_SECRET` (≥32 random bytes; `openssl rand -base64 32`) and add to `/etc/memory-fs/env` next to the existing `MEMORY_FS_TOKEN`. Also set `MEMORY_FS_BASE_URL=https://memory.enzotech.io` if `MEMORY_FS_DOMAIN` isn't already enough. File stays mode 600.
- [ ] **7b — `deploy/memory-fs.service`**: confirm `EnvironmentFile=/etc/memory-fs/env` picks up the new vars (no change required if it's already pointing there). Commit only if file changes.
- [ ] **7c — Build + push to VM**: standard `npm run build` then deploy (existing workflow). On the VM, install new deps (`npm ci`) and run `npm run auth:migrate` ONCE against `/var/lib/memory-fs/memory.db`. Confirm the migration only adds Better Auth tables; the existing memory data is untouched (back up before, just in case: `sqlite3 /var/lib/memory-fs/memory.db ".backup '/tmp/pre-phase-6.db'"`).
- [ ] **7d — Restart**: `systemctl restart memory-fs`; tail logs and confirm `connected over stdio` is gone and you see `listening on …` plus the discovery routes responding.
- [ ] **7e — Live smoke** (from your laptop):
  ```
  curl -s https://memory.enzotech.io/.well-known/oauth-protected-resource | jq .
  curl -s https://memory.enzotech.io/.well-known/oauth-authorization-server/api/auth | jq .
  curl -i -s -o /dev/null -w "no-auth → %{http_code}\n" -X POST https://memory.enzotech.io/mcp -H "content-type: application/json" -d '{}'
  curl -i -s -o /dev/null -w "static bearer → %{http_code}\n" -X POST https://memory.enzotech.io/mcp -H "Authorization: Bearer $MEMORY_FS_TOKEN" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  ```
  Expected: both discovery docs return JSON; no-auth → 401; static bearer → 200 with MCP initialize result. **If any of these fail, stop and fix before Task 8** (don't attempt the Claude flow with broken protocol surface).

### Task 8 — Claude.ai connector verification

**Files:** none (manual).

- [ ] Seed yourself a user via the live server: `curl -s -X POST https://memory.enzotech.io/api/auth/sign-up/email -H "content-type: application/json" -d '{"name":"Ben","email":"ben@useenso.co","password":"<strong>"}'`. (Or build a tiny one-time admin CLI; either is fine.)
- [ ] In Claude.ai: Settings → Connectors → Add custom connector → URL `https://memory.enzotech.io/mcp`. Walk the flow: login → consent → wait for "Connected." If Claude shows the 7 memory tools, the handshake passed.
- [ ] In a Claude chat, call `memory_note` then `memory_recall`. Confirm via `https://memory.enzotech.io/` UI (or `sqlite3 …memory.db "select namespace,key from memories order by id desc limit 5"`) that the new row's namespace is `user:<your-userId>` — proves per-user namespacing fired.
- [ ] Also confirm Claude mobile sees the connector (account-synced) and a tool call still works.
- [ ] If the handshake fails: tail `journalctl -u memory-fs -f` while retrying; the request log shows which leg broke. The most likely spots are the login → consent → authorize bounce and the redirect_uri allowlist behavior under DCR.
- [ ] Update memory `memory-fs-hosted-shared-store.md` "Deployment status" line with the verdict (date, claude.ai web + mobile working ✅/❌).

### Task 9 — Docs

**Files:** `README.md`, `docs/adr/0001-oauth-better-auth-in-process.md`.

- [ ] **README**: add an "OAuth (Claude.ai web + mobile, Cursor, …)" section under Hosting. Two bullets: connector URL = `https://memory.enzotech.io/mcp`; the shared bearer token still works for Claude Code / Cursor / CLI clients.
- [ ] **ADR**: short ADR capturing what's locked from prior research (Better Auth, in-process, DCR, dual-auth, deferred social/CIMD). Future readers shouldn't have to re-derive it.
- [ ] Commit: `docs: phase 6 — OAuth via Better Auth`.

---

## Verification (end of phase)

1. **Tests green:** full `npm test` returns exit 0, including `tests/oauth.test.ts`.
2. **Live protocol surface:** Task 7e smoke commands all succeed against `https://memory.enzotech.io`.
3. **Claude.ai web:** connector added cleanly, `memory_note` + `memory_recall` work, written row lands at `user:<id>` namespace.
4. **Claude mobile:** connector syncs from web; one tool call succeeds.
5. **Static bearer regression:** Claude Code (and the eval harness, if you re-run a smoke) still works against the live server with `Authorization: Bearer $MEMORY_FS_TOKEN`.
6. **No FTS5/WAL coexistence issues** (the untested unknown flagged in the memory note): write 20 records via the OAuth path under load, confirm FTS5 search still returns them.

## Notes for follow-up phases
- **6.1 Social login** (GitHub, Google) — one-plugin add on `betterAuth({...})`.
- **6.2 Migrate `shared` namespace** to specific users if anyone has authored under the static-bearer path.
- **6.3 MCP Registry publish** once the registry exits preview.
- **6.4 CIMD** when Better Auth ships support (it's "under debate" upstream; we tracked it in the hosted-store memory).
