# memory-fs Phase 5: Hosted shared store on GCP (free tier)

**Goal:** Run one shared memory-fs server the whole team reads/writes, over HTTPS, on GCP's Always Free tier — effectively $0/month. Add a Streamable HTTP transport guarded by a shared bearer token, run it on a single `e2-micro` VM under systemd behind Caddy (auto Let's Encrypt TLS on an existing domain), and back the SQLite file up nightly to a GCS bucket.

**Architecture (deliberately small):**
- **1× `e2-micro` VM** (Debian, `us-central1` — Always Free region). Boot disk (30 GB standard PD, free) holds the live SQLite DB at `/var/lib/memory-fs/memory.db`. No separate disk, no Docker, no Artifact Registry.
- **Transport:** server picks transport by env — `MEMORY_FS_HTTP_PORT` set → Streamable HTTP; unset → stdio (so tests + local use are unchanged). HTTP listens on `127.0.0.1` only.
- **Auth:** every HTTP request must carry `Authorization: Bearer <MEMORY_FS_TOKEN>`; reject otherwise. One shared token.
- **TLS:** Caddy reverse-proxies `https://<domain>` → `127.0.0.1:<port>`, auto-provisioning a Let's Encrypt cert. Only 80/443 open to the internet; the Node port is never exposed.
- **Durability:** a nightly cron runs `sqlite3 memory.db "VACUUM INTO snapshot"` then `gsutil cp` to a GCS bucket, keeping the last 14 days. (Upgrade path: swap for a Litestream sidecar for point-in-time recovery.)

**Single instance only** — better-sqlite3 is one writer. No autoscaling, ever.

**Out of scope:** per-user identity/namespacing, OAuth, multi-region, HA. Revisit if the team outgrows one box.

---

## Decisions (locked)
- Compute: `e2-micro` Always Free VM (not Cloud Run). Region `us-central1`.
- Auth: one shared bearer token, stored as a systemd env file (`/etc/memory-fs/env`, mode 600), never in git.
- TLS: Caddy + Let's Encrypt on an existing domain (set `MEMORY_FS_DOMAIN`).
- Backup: nightly `VACUUM INTO` + `gsutil cp` to a GCS bucket.

---

## File structure

**Modify:**
- `src/server.ts` — transport switch (HTTP vs stdio) + bearer-token middleware.
- `package.json` — no new runtime deps (SDK already ships `streamableHttp`); add `"start:http"` script.

**Create:**
- `deploy/Caddyfile` — reverse proxy + auto TLS.
- `deploy/memory-fs.service` — systemd unit.
- `deploy/backup.sh` + `deploy/memory-fs-backup.{service,timer}` — nightly GCS backup.
- `deploy/README.md` — provisioning + deploy runbook.
- `tests/server.http.test.ts` — boots HTTP mode, asserts 401 without token and a tool round-trip with token.

---

## Tasks

### Task 1: Transport switch + bearer-token auth in `server.ts`

- [ ] **Step 1: Write failing test** `tests/server.http.test.ts`
  - Spawn `dist/server.js` with `MEMORY_FS_HTTP_PORT=<rand>`, `MEMORY_FS_TOKEN=secret`, `MEMORY_FS_DB=<tmp>`.
  - Assert: POST `/mcp` without `Authorization` → HTTP 401.
  - Assert: with `Authorization: Bearer secret`, an `initialize` + `tools/list` round-trip returns the 7 tool names.

- [ ] **Step 2: Implement.** In `src/server.ts`, after building `server`, branch on `process.env.MEMORY_FS_HTTP_PORT`:
  - **Unset →** existing `StdioServerTransport` path (unchanged).
  - **Set →** create a minimal `node:http` server. Reject any request lacking `Authorization: Bearer ${process.env.MEMORY_FS_TOKEN}` with `401` before touching MCP. Otherwise hand the request to a `StreamableHTTPServerTransport` (from `@modelcontextprotocol/sdk/server/streamableHttp.js`) bound to the MCP server. Bind to `127.0.0.1`. Require `MEMORY_FS_TOKEN` to be non-empty when HTTP mode is on; crash with a clear message if it isn't (boundary validation).
  - Keep all 7 `registerTool` calls exactly as-is.

- [ ] **Step 3:** `npx tsc && npm test -- server.http` → pass. Full `npm test` → still green (stdio smoke unaffected).

- [ ] **Step 4:** Commit `feat: optional Streamable HTTP transport with bearer auth`.

### Task 2: Deploy artifacts (Caddy, systemd, backup)

- [ ] `deploy/Caddyfile`:
  ```
  {$MEMORY_FS_DOMAIN} {
      reverse_proxy 127.0.0.1:{$MEMORY_FS_HTTP_PORT}
  }
  ```
- [ ] `deploy/memory-fs.service` — `ExecStart=/usr/bin/node /opt/memory-fs/dist/server.js`, `EnvironmentFile=/etc/memory-fs/env`, `WorkingDirectory=/opt/memory-fs`, `Restart=always`, runs as a non-root `memoryfs` user, `WantedBy=multi-user.target`.
- [ ] `deploy/backup.sh` — `sqlite3 "$DB" "VACUUM INTO '/tmp/memory-$(date +%F).db'"`, `gsutil cp` to `gs://$BUCKET/`, prune objects older than 14 days. `deploy/memory-fs-backup.timer` runs it daily.
- [ ] Commit `chore: deploy artifacts for GCP single-VM host`.

### Task 3: GCP bootstrap (from scratch)

- [ ] **Install/auth gcloud** (if needed): install the SDK, `gcloud auth login`, `gcloud config set project <PROJECT>`. *(Run interactive logins yourself via the `!` prefix.)*
- [ ] **Enable APIs:** `gcloud services enable compute.googleapis.com storage.googleapis.com`.
- [ ] **Create the backup bucket:** `gsutil mb -l us-central1 gs://<PROJECT>-memory-fs-backups`; set a 14-day lifecycle delete rule.
- [ ] **Create the VM:** `gcloud compute instances create memory-fs --machine-type=e2-micro --zone=us-central1-a --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB` (attach a service account scoped to `storage.objectAdmin` on the bucket only).
- [ ] **Firewall:** allow `tcp:80,443` from `0.0.0.0/0`; everything else closed. (Node port stays on localhost.)
- [ ] Record the external IP; point your domain's A record at it.

### Task 4: Provision the box + deploy

- [ ] SSH in (`gcloud compute ssh memory-fs`). Install Node 22 (NodeSource), `sqlite3`, Caddy (official apt repo), and create the `memoryfs` user + `/var/lib/memory-fs`.
- [ ] Clone the repo to `/opt/memory-fs`, `npm ci`, `npm run build`.
- [ ] Write `/etc/memory-fs/env` (mode 600): `MEMORY_FS_HTTP_PORT=8787`, `MEMORY_FS_TOKEN=<generated>`, `MEMORY_FS_DB=/var/lib/memory-fs/memory.db`, `MEMORY_FS_DOMAIN=<domain>`, `BUCKET=<bucket>`.
- [ ] Install the systemd units + timer; `systemctl enable --now memory-fs caddy memory-fs-backup.timer`.
- [ ] Configure Caddy with the `Caddyfile` (env-substituted); reload.

### Task 5: Verify end-to-end

- [ ] `curl -i https://<domain>/mcp` → **401** (no token). Confirms auth + TLS.
- [ ] An MCP `initialize` + `tools/list` with the bearer header → **7 tools**.
- [ ] A `memory_note` then `memory_recall` round-trip over HTTPS returns the written record.
- [ ] Trigger `backup.sh` once manually; confirm an object lands in the bucket.
- [ ] Add the server to one teammate's MCP client (`url` + `Authorization` header) and confirm a real recall works.

---

## Client config (for teammates)
```json
{
  "mcpServers": {
    "memory-fs": {
      "url": "https://<domain>/mcp",
      "headers": { "Authorization": "Bearer <shared-token>" }
    }
  }
}
```

## Cost
- `e2-micro` + 30 GB standard PD + <5 GB GCS in `us-central1`: **$0/month** under Always Free, barring heavy egress (MCP payloads are tiny JSON). One free e2-micro per billing account — confirm you're not already using it elsewhere.

## Notes for later
- Outgrow one box → migrate to Cloud SQL/Turso + per-user tokens + namespacing, and only then consider >1 instance.
- Want point-in-time recovery → replace the nightly cron with a Litestream sidecar replicating to the same bucket.
