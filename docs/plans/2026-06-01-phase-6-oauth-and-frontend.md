# Phase 6 — OAuth (Better Auth) + React/Vite frontend

**Status:** in progress (2026-06-01). **Supersedes** `2026-05-30-phase-6-oauth-better-auth.md`,
which described an abandoned dual-auth design (static `MEMORY_FS_TOKEN` + Better Auth
`mcpHandler`). The shipped design removes the static token and verifies bearers locally
via `jose`/JWKS.

Decisions behind this work live in [`CONTEXT.md`](../../CONTEXT.md) (vocabulary: AS, RS,
Principal, the `{issuer, audience}` contract, session-vs-bearer split) and
[`docs/adr/0001-rs-verifies-bearers-locally.md`](../adr/0001-rs-verifies-bearers-locally.md)
(local JWKS verify, no introspection). Don't re-litigate those here.

## Where we are

**Auth layer (`src/lib/`, flat):**
- `auth.ts` — the **Authorization Server**: Better Auth + `@better-auth/oauth-provider`
  in-process. Exports `authContract(baseUrl)` = `{issuer, audience, jwksUri}` — the single
  home of the AS↔RS contract; `validAudiences` derives from it.
- `resource-server.ts` — the **Resource Server**: `makeAuthenticate` (local JWKS verify →
  `Principal {sub}`) + `serveProtectedResourceMetadata` (PRM built from the same contract).
- `auth-ui.ts` — serves the AS's built login/consent pages from `dist/ui`, same-origin.
- `mcp-server.ts` — the 7 MCP tools.
- `index.ts` — a **flat dispatcher**: AS routes → Better Auth; RS routes (PRM + `/mcp`) →
  resource-server; AS login/consent UI → auth-ui; else → `authenticate`.
- **Removed:** the static `MEMORY_FS_TOKEN` path; `src/lib/ui-server.ts` + its test (the
  deprecated proxy); the old vanilla `src/lib/ui/*.{html,js}`.

**Frontend (`ui/`, Vite + React):**
- Multi-page (not a SPA): two entries `sign-in.html`, `consent.html` → `src/sign-in.tsx`,
  `src/consent.tsx`. Built to `dist/ui` by `vite build ui`, served same-origin by `auth-ui.ts`.
- `sign-in.tsx` = a single **"Continue with Google"** button. Resumes the OAuth flow via
  `signIn.social({ provider: "google", callbackURL: "/api/auth/oauth2/authorize" + location.search })`
  — the `callbackURL` is how the signed authorize query survives Google's redirect.
- `consent.tsx` = React port of the old `consent.js` (reads `client_id`/`scope`, POSTs to
  `/api/auth/oauth2/consent`); React auto-escaping replaces the old `textContent` XSS guard.
- Tooling: **vite 8 / @vitejs/plugin-react 6 / vitest 4** (coordinated latest bump).

**Tests:** 34/34 green on vitest 4. HTTP tests cover the 401 gate + PRM contents; stdio
smoke covers the 7-tool surface.

## Architecture decisions (don't re-litigate)

- **RS verifies bearers locally via JWKS, no introspection** — ADR-0001. Revocation handled
  by short token TTLs. The deprecated Better Auth `mcp` plugin (DB-lookup introspection) is a
  dead end.
- **Two auth paths, one AS:** bearer/JWT (MCP, future API) verified locally; session/cookie
  (browser UI) deferred to Better Auth `getSession`.
- **Frontend is hybrid on purpose:** MPA + no router for the OAuth screens (they're
  server-redirect targets); a future single SPA entry + `react-router` (library mode) for the
  memory browser. No meta-framework unless SSR/loaders become a real need.
- **Force Google:** email/password disabled **server-side** (not just hidden in the UI).

## Remaining work

### Chunk 4 — force Google (pending)
- `auth.ts`: `emailAndPassword: { enabled: false }`. Ensure `http://localhost:5173` is a
  trusted origin in dev (it is, via `baseUrl`).
- Consequence: any existing email/password accounts can no longer log in that way.

### 3b — verify end-to-end (pending)
Run the dev runbook below and complete a real Google login through the MCP Inspector
(expect it to list the 7 tools on success).

### Phase B — memory browser (future; needs its own grilling pass)
- A **session-authenticated JSON API** in front of `MemoryStore` (the "API" surface, distinct
  from `/mcp`). Do **not** resurrect the old `ui-server` proxy — design it.
- A third Vite entry (`app.html` → routed SPA, `react-router` library mode).

## Dev runbook (3b)

`.env` (dev): `MEMORY_FS_HTTP_PORT=3000`, `MEMORY_FS_BASE_URL=http://localhost:5173`,
`BETTER_AUTH_SECRET=<32+ chars>`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Google Console authorized redirect URIs: `http://localhost:5173/api/auth/callback/google`
(dev) and `https://memory.enzotech.io/api/auth/callback/google` (prod). Add yourself as a
Test user while the consent screen is in Testing mode.

Three terminals:
1. `npm run dev` — Node AS+RS on :3000 (serves `/api/auth`, `/mcp`).
2. `npm run dev:ui` — Vite on :5173 (serves `/sign-in` `/consent` + HMR; proxies `/api/auth`
   & `/mcp` → :3000). `BASE_URL=:5173` makes the AS advertise the Vite origin so the whole
   flow is one origin.
3. `npx @modelcontextprotocol/inspector` — Streamable HTTP, URL `http://localhost:5173/mcp`,
   Connect → DCR → `/sign-in` → Google → `/consent` → Allow → connected.

Gotchas: `redirect_uri_mismatch` (Console URI must match byte-for-byte); Google "access
blocked" (add Test user); session lost after login (likely `Secure`-cookie-on-`http` — the
one dev-only auth tweak, add if hit).

## Production notes
- Build: `npm run build` = `vite build ui && tsc`. `node dist/index.js` serves `dist/ui`
  same-origin. `MEMORY_FS_BASE_URL` = the public https domain; register the prod Google
  redirect URI.
