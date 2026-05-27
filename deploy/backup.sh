#!/usr/bin/env bash
set -euo pipefail

# Backup memory-fs SQLite database to GCS.
# Required env: BUCKET (GCS bucket name, no gs:// prefix)
# Optional env: DB (path to SQLite file; default /var/lib/memory-fs/memory.db)

DB="${DB:-/var/lib/memory-fs/memory.db}"

# Validate BUCKET early — fail clearly rather than silently at gsutil time.
if [[ -z "${BUCKET:-}" ]]; then
    echo "ERROR: BUCKET env var is required (e.g. BUCKET=my-backup-bucket)" >&2
    exit 1
fi

DATESTAMP=$(date -u +%Y-%m-%d)
# Include hostname so a shared bucket can hold backups from multiple servers
# without prune runs on one host touching another host's objects.
SNAPSHOT="/tmp/memory-$(hostname -s)-${DATESTAMP}.db"
# Remove snapshot on exit (success or failure) so a crashed run can't leave a
# stale file that makes VACUUM INTO fail on the next run (it refuses to overwrite).
trap 'rm -f "$SNAPSHOT"' EXIT

# Clear any leftover snapshot from a previously crashed run before we write.
rm -f "$SNAPSHOT"

# VACUUM INTO produces a consistent, WAL-safe copy — safer than cp on a live DB.
sqlite3 "$DB" "VACUUM INTO '${SNAPSHOT}'"

gsutil cp "$SNAPSHOT" "gs://${BUCKET}/"

# Pruning: GCS bucket lifecycle rules are the preferred mechanism for retention
# (set a 14-day DeleteAction rule on the bucket). The block below is best-effort
# in-script pruning as a fallback; it may miss objects if gsutil ls output format
# changes, so don't rely on it as the sole retention mechanism.
# Prune glob is scoped to this host so we don't remove sibling-server backups.
CUTOFF=$(date -u -d "14 days ago" +%Y-%m-%d 2>/dev/null || date -u -v-14d +%Y-%m-%d)
gsutil ls -l "gs://${BUCKET}/memory-$(hostname -s)-*.db" 2>/dev/null | while read -r size date_str name; do
    [[ "$name" == gs://* ]] || continue
    file_date=$(echo "$date_str" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
    if [[ -n "$file_date" && "$file_date" < "$CUTOFF" ]]; then
        gsutil rm "$name"
    fi
done || true  # pruning failures are non-fatal
