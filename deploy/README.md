# deploy/ — operator runbook

Deployment artifacts for a single Debian 12 GCE `e2-micro` VM. The DB lives at `/var/lib/memory-fs/memory.db`; the application is served from `/opt/memory-fs/current` (an atomic symlink).

---

## Env file

Create `/etc/memory-fs/env` on the host. It must be owned by root, mode 600. **Never commit it.**

```
MEMORY_FS_HTTP_PORT=3456
MEMORY_FS_DOMAIN=memory.useenso.co
MEMORY_FS_DB=/var/lib/memory-fs/memory.db
BETTER_AUTH_SECRET=<32+ random chars — openssl rand -base64 32>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
BUCKET=<gcs-bucket-name>
```

---

## Install systemd units

```bash
cp /opt/memory-fs/deploy/memory-fs.service         /etc/systemd/system/
cp /opt/memory-fs/deploy/memory-fs-backup.service  /etc/systemd/system/
cp /opt/memory-fs/deploy/memory-fs-backup.timer    /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now memory-fs.service
systemctl enable --now memory-fs-backup.timer
```

---

## Caddy

Install Caddy and point it at `deploy/Caddyfile`. Caddy needs `MEMORY_FS_DOMAIN` and `MEMORY_FS_HTTP_PORT` in its environment. It handles HTTPS and cert renewal automatically.

### Caddy env drop-in

The stock Debian Caddy systemd unit does **not** load an env file by default, so the variables won't reach the Caddyfile without a drop-in. Create it once:

```bash
mkdir -p /etc/systemd/system/caddy.service.d
```

`/etc/systemd/system/caddy.service.d/env.conf`:

```ini
[Service]
EnvironmentFile=/etc/caddy/caddy.env
```

`/etc/caddy/caddy.env` (mode 600, owned root):

```
MEMORY_FS_DOMAIN=memory.example.com
MEMORY_FS_HTTP_PORT=3456
```

Then `systemctl daemon-reload && systemctl restart caddy`.

---

Full provisioning steps: `docs/plans/2026-05-27-phase-5-hosted-gcp.md`

---

## Release layout

```
/opt/memory-fs/
  current         → releases/<sha>/        # atomic symlink; what the service runs
  releases/
    <sha>/                                 # extracted release (dist/ node_modules/ package.json)
    <sha>/
    …                                      # newest 5 retained; older pruned on each deploy
  staging/
    <sha>.tar.gz                           # rsynced by CI before activation
  bin/
    activate.sh                            # swap script, also rsynced by CI
```

The DB at `/var/lib/memory-fs/` is entirely outside this tree. Deploys never touch it.

---

## CI/CD setup

### GitHub Actions secrets

Set these under repo Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | Private key whose public half is in the deploy user's `authorized_keys` on the box |
| `DEPLOY_HOST` | Box hostname or IP |
| `DEPLOY_USER` | SSH user on the box (e.g. `deploy`) |
| `DEPLOY_PORT` | Optional; defaults to 22 |

### Box-side prerequisites

1. **Deploy user** with its public key in `~/.ssh/authorized_keys`.

2. **Writable staging + bin dirs** — `rsync --mkpath` creates them during the deploy step, but the parent `/opt/memory-fs` must be writable by the deploy user, or pre-create the dirs with correct ownership:

   ```bash
   mkdir -p /opt/memory-fs/staging /opt/memory-fs/bin
   chown deploy:deploy /opt/memory-fs/staging /opt/memory-fs/bin
   ```

3. **Passwordless sudo** scoped to the activate script. Add a sudoers drop-in:

   ```
   deploy ALL=(root) NOPASSWD: /opt/memory-fs/bin/activate.sh
   ```

   (`visudo -f /etc/sudoers.d/memory-fs-deploy`)

4. **`releases/` and `current` writable by root** — `activate.sh` runs under sudo and owns those paths.

5. **Debian 12 box** — rsync ≥ 3.2.3 required for `--mkpath` (bookworm ships 3.2.7). ✓

### Node version invariant

The box's `node` major **must equal** the version in `.nvmrc` (currently `22`). CI compiles the native better-sqlite3 addon inside a `debian:12` container against that major; if the box runs a different Node major, the prebuilt `.node` file won't load and the health gate will (correctly) roll back the deploy. When upgrading Node, update `.nvmrc` **and** the box together before the next deploy.

---

## One-time host migration

If the box was provisioned under the old layout (code run directly from `/opt/memory-fs`), migrate to the symlink layout before the first CI deploy:

```bash
# 1. Create the new directories
mkdir -p /opt/memory-fs/releases /opt/memory-fs/staging /opt/memory-fs/bin
# staging + bin must be writable by the deploy user
chown deploy:deploy /opt/memory-fs/staging /opt/memory-fs/bin

# 2. Seed the currently-running code as a named release.
#    Use the current HEAD sha or any identifier that won't collide with real SHAs.
SHA=$(git -C /opt/memory-fs rev-parse HEAD)
cp -a /opt/memory-fs/dist   /opt/memory-fs/releases/${SHA}/dist
cp -a /opt/memory-fs/node_modules /opt/memory-fs/releases/${SHA}/node_modules
cp    /opt/memory-fs/package.json /opt/memory-fs/releases/${SHA}/package.json

# 3. Point the symlink at the seeded release
ln -sfn /opt/memory-fs/releases/${SHA} /opt/memory-fs/current

# 4. Install the updated unit (ExecStart now references current/) and restart
cp /opt/memory-fs/deploy/memory-fs.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart memory-fs
```

Verify with `curl -s http://127.0.0.1:$PORT/health` before declaring done.

---

## Rollback and operations

**Automatic rollback:** if `activate.sh`'s health gate doesn't get a `200` from `/health` within 30 s, it repoints `current` back to the previous release and restarts the service. The deploy exits nonzero and the CI job is marked failed.

**Manual rollback:**

```bash
# List available releases (newest first by mtime)
ls -lt /opt/memory-fs/releases/

# Repoint and restart
sudo ln -sfn /opt/memory-fs/releases/<prior-sha> /opt/memory-fs/current
sudo systemctl restart memory-fs
```

**Release retention:** `activate.sh` keeps the newest 5 releases; older ones are pruned after a successful deploy. The active release is never pruned regardless of position.

**DB backups before destructive migrations:** additive schema changes (add table/column) are safe to ship under the rolling restart — the old code can still read the new schema. Destructive changes (drop/rename column or table) are not safe and must be a separately-scheduled, downtime-accepting deploy. Before any such deploy, confirm that `memory-fs-backup.timer` has taken a fresh snapshot to GCS (or trigger one manually). See the Invariants section in `docs/plans/2026-06-07-continuous-deployment.md`.
