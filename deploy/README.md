# deploy/ — operator runbook

Deployment artifacts for a single Debian 12 GCE `e2-micro` VM. The repo lives at `/opt/memory-fs`; the DB at `/var/lib/memory-fs/memory.db`.

---

## Env file

Create `/etc/memory-fs/env` on the host. It must be owned by root, mode 600. **Never commit it.**

```
MEMORY_FS_HTTP_PORT=3456
MEMORY_FS_TOKEN=<random-bearer-token>
MEMORY_FS_DB=/var/lib/memory-fs/memory.db
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

Install Caddy and point it at `deploy/Caddyfile`. Caddy needs `MEMORY_FS_DOMAIN` and `MEMORY_FS_HTTP_PORT` in its environment (e.g. via `/etc/caddy/caddy.env` loaded by the Caddy systemd unit). It handles HTTPS and cert renewal automatically.

---

Full provisioning steps: `docs/plans/2026-05-27-phase-5-hosted-gcp.md`
