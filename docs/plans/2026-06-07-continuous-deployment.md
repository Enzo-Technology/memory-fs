# Continuous deployment with minimal downtime — scoping

**Status:** scoping / ready to pick up. Not yet implemented.
**Goal:** push to `main` → memory-fs is live on the GCE box within minutes, with
near-zero request downtime and automatic abort if the new build is unhealthy.

## Current state (what we're replacing)

- One Debian 12 GCE `e2-micro` VM (1 GB RAM, shared CPU). Repo `/opt/memory-fs`,
  DB `/var/lib/memory-fs/memory.db`, single SQLite file (WAL, `busy_timeout=5000`).
- `memory-fs.service` runs `node /opt/memory-fs/dist/index.js`, listening on
  `127.0.0.1:$PORT`; Caddy reverse-proxies the domain to it and terminates TLS.
- Deploy today is manual: `git archive → scp → build on-box → swap → restart`.
  That restart drops in-flight requests, and the **on-box build is the real risk** —
  `npm ci` (rebuilds the better-sqlite3 native addon) + `tsc` + `vite build` under
  1 GB RAM can OOM, taking the service down mid-build.

## Two facts that make this easy

1. **The MCP HTTP transport is already stateless** — `src/index.ts:93` constructs
   `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, a fresh
   transport + server per request, closed on `res.close`. No long-lived sessions to
   drain, no session affinity. A cutover cannot strand an in-progress MCP session.
2. **Our migrations are additive + idempotent** — `migrate()` is `CREATE … IF NOT
   EXISTS` + `addColumnIfMissing` (`src/core/db.ts`); Better Auth migrations run at
   boot and are additive. So a new version can migrate the shared DB while the old
   version keeps serving the old columns. **This is the load-bearing invariant** (see
   "Invariants" below).

## Recommendation

Do the dumbest thing that meets the goal, in two tiers. **Ship Tier 0 first** — it
likely already satisfies "not too much downtime." Add Tier 1 only if the ~1–2 s blip
turns out to matter.

### Tier 0 — CI build + artifact ship + graceful restart  ← start here

The downtime win is mostly from moving the **build off-box**, not from blue-green.

1. **GitHub Actions on push to `main`:** `npm ci`, `npm run build`, `npm test`. Fail =
   no deploy.
2. **Produce a ready artifact:** tarball of `dist/` + `node_modules` + `package.json`.
   ⚠️ `node_modules` contains the **native** better-sqlite3 addon — it must be built on
   a runner matching the box (Debian 12, x86_64, same Node major; the engine is already
   pinned). Either run the build job in a `debian:12` container with that Node, or keep
   `npm ci` on-box for *only* the native rebuild. **Open decision below.**
3. **Ship + atomic swap:** rsync to `/opt/memory-fs/releases/<sha>/`, then repoint a
   symlink `/opt/memory-fs/current → releases/<sha>` (atomic `ln -sfn`). systemd
   `ExecStart` runs `…/current/dist/index.js`.
4. **Graceful restart:** add a `SIGTERM` handler that calls `httpServer.close()` (stop
   accepting, let in-flight finish) before exit — see task list. Then `systemctl restart
   memory-fs`. With the stateless transport + graceful close, the blip is sub-second to
   ~2 s of connection refusals that MCP clients retry through.
5. **Keep N releases**, prune the rest. Rollback = repoint the symlink to the previous
   `<sha>` and restart.

Downtime: a brief window where the socket is down during restart. For a small team
tool, acceptable.

### Tier 1 — blue-green via Caddy graceful reload  (upgrade, if Tier 0's blip matters)

Eliminates the restart blip entirely.

1. Two systemd instances `memory-fs@blue` / `memory-fs@green`, each with a per-color
   env drop-in setting `MEMORY_FS_HTTP_PORT` (e.g. 3456/3457) and its release dir.
2. Deploy to the **idle** color, then poll its `/health` on loopback until green
   (timeout → abort, old color keeps serving — zero impact).
3. **Flip:** rewrite the Caddy upstream port and `caddy reload` (graceful — Caddy
   drains in-flight connections onto the new upstream without dropping any).
4. `SIGTERM` the old color (drains via the graceful handler). It becomes the new idle.

Both colors briefly hold the same SQLite file open — fine under WAL (one writer,
serialized by `busy_timeout`); writes from the two processes interleave safely for the
few-second overlap. Memory: two small Node processes fit in 1 GB; the build (the heavy
part) already happened off-box in CI.

## Invariants (do not violate)

- **Additive migrations only on the automated path.** During any overlap (Tier 1) or
  rolling restart (Tier 0 with a still-draining old process), the old code runs against
  the new schema. Adding tables/columns is safe; **dropping/renaming a column or table
  is not** — it breaks the old process mid-flight. A destructive migration must be a
  separate, explicitly-scheduled, downtime-accepting deploy (expand → migrate data →
  contract, across two releases). This is the same expand/contract discipline our
  CLAUDE.md and the `flagged-deployment` skill encode.
- **Health gate before flip.** Never route to a color that hasn't returned `/health` 200.
- **One source of truth for secrets.** CI never holds `/etc/memory-fs/env`; it ships
  code only. The box keeps owning its env file (mode 600).
- **DB lives outside the release dir** (`/var/lib/memory-fs`) — already true; releases
  are disposable, the DB is not.

## Task list for the picking-up agent

Code (this repo) — **done** (landed with this doc, on `feat/oauth-better-auth`):
- [x] `SIGTERM`/`SIGINT` handler in `src/index.ts` — `httpServer.close()`, close DB, exit.
- [x] Unauthenticated `GET /health` returning `200 {status:"ok"}` — the readiness probe.
- [x] Origin validation on `/mcp` (also closes [[0003-target-mcp-spec-2025-11-25]]).

Infra:
- [ ] `.github/workflows/deploy.yml`: build + test + package; gate deploy on green.
- [ ] Decide the native-build strategy (see Open decisions) and implement step 2.
- [ ] Release-dir + symlink layout under `/opt/memory-fs/releases/`; switch
      `memory-fs.service` `ExecStart`/`WorkingDirectory` to `…/current`.
- [ ] Ship/swap/restart script (idempotent, rollback = repoint symlink).
- [ ] **Tier 1 only:** `memory-fs@.service` template + per-color env drop-ins; Caddy
      upstream-swap + `caddy reload`; idle-color health-poll-then-flip script.
- [ ] Update `deploy/README.md` runbook + this doc's status.

## Open decisions (need a human or a quick spike)

1. **Where does the native better-sqlite3 addon get built?** (a) CI in a Debian-12
   container matching the box — fully off-box, fastest cutover, but must pin
   arch/glibc/Node exactly; (b) ship source + `npm ci --omit=dev` on-box for the native
   rebuild only — simpler, keeps a little build load on the e2-micro. Recommend (a) if
   we can match the image cleanly, else (b).
2. **Tier 0 vs Tier 1 to start.** Recommend Tier 0 — measure the actual restart blip
   against real MCP client retry behavior before building blue-green. Default to no on
   Tier 1 until the blip is shown to hurt.
3. **How does the box authenticate to GitHub for the pull/rsync?** Deploy key, or a
   self-hosted runner on the box (heavier on an e2-micro), or push-from-CI over SSH with
   a deploy key. Recommend push-from-CI over SSH.
4. **Backups around deploys.** `memory-fs-backup.timer` already snapshots the DB to GCS;
   confirm a fresh snapshot is taken (or is recent) before any deploy that runs a
   migration, so rollback has a matching DB.

## Why not multi-node / managed PaaS

A single SQLite file on local disk is the substrate. True horizontal scaling is a
different architecture (replicated/served DB) and belongs to the hosted-shared-store
question (Phase 6 / the undefined wedge), not to this CD change. Keep this scoped to
zero-ish-downtime deploys of the single box.
