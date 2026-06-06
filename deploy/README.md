# deploy/ — operator runbook

Deployment artifacts for a single Debian 12 GCE `e2-micro` VM. The repo lives at `/opt/memory-fs`; the DB at `/var/lib/memory-fs/memory.db`.

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
MEMORY_FS_ALLOWED_HD=useenso.co
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
