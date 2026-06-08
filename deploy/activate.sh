#!/usr/bin/env bash
set -euo pipefail

# activate.sh — Release-swap script for memory-fs Tier 0 CD.
#
# Invoked on the production box (Debian 12 GCE VM) over SSH by the GitHub
# Actions deploy job, AFTER the artifact tarball has been rsynced to the box.
# There is no build step here; the tarball is a fully prebuilt release.
#
# Usage: activate.sh <sha> [<tarball-path>]
#   sha          — git commit SHA being deployed
#   tarball-path — path to the artifact tarball already on the box
#                  (default: /opt/memory-fs/staging/<sha>.tar.gz)
#
# Privilege: must run with sufficient privilege to write under /opt/memory-fs,
# read /etc/memory-fs/env (mode 600), and run `systemctl restart memory-fs`.
# Run via sudo or as root; do NOT call sudo inside this script.
#
# Rollback: if the health gate fails, the symlink is repointed to the previous
# release (if one existed) and the service is restarted. If this is a first
# deploy (no previous release), the broken release is left in place and the
# script exits nonzero.
#
# Env overrides:
#   BASE           — release tree root (default: /opt/memory-fs)
#   KEEP_RELEASES  — number of releases to retain (default: 5)

BASE="${BASE:-/opt/memory-fs}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SERVICE="memory-fs"
ENV_FILE="/etc/memory-fs/env"
HEALTH_TIMEOUT=60   # seconds to wait for /health 200 (allows for boot-time DB migrations)
HEALTH_INTERVAL=2   # seconds between polls

# ---------------------------------------------------------------------------
# 1. Validate inputs
# ---------------------------------------------------------------------------

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
    echo "ERROR: SHA argument is required" >&2
    exit 1
fi

TARBALL="${2:-${BASE}/staging/${SHA}.tar.gz}"
if [[ ! -f "$TARBALL" ]]; then
    echo "ERROR: tarball not found: $TARBALL" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Capture the current release (for rollback)
# ---------------------------------------------------------------------------

PREVIOUS_RELEASE=""
if [[ -L "${BASE}/current" ]]; then
    PREVIOUS_RELEASE="$(readlink -f "${BASE}/current")"
fi

# ---------------------------------------------------------------------------
# 3. Extract the tarball into $BASE/releases/<sha>/
# ---------------------------------------------------------------------------

RELEASE_DIR="${BASE}/releases/${SHA}"
TMP_DIR="${BASE}/releases/${SHA}.tmp"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
tar -xzf "$TARBALL" -C "$TMP_DIR" --strip-components=0
rm -rf "$RELEASE_DIR"
mv "$TMP_DIR" "$RELEASE_DIR"

# The service runs as an unprivileged user (memoryfs) but releases are root-owned
# (this script runs under sudo). Make the tree world-readable/traversable so the
# service user can read current/dist/index.js — otherwise ExecStart fails EACCES
# and every deploy silently fails the health gate. a+rX = read on files, traverse
# on dirs, without flipping the execute bit on regular files.
chown -R root:root "$RELEASE_DIR"
chmod -R a+rX "$RELEASE_DIR"

# ---------------------------------------------------------------------------
# 4. Atomic symlink flip
# ---------------------------------------------------------------------------

# -n: if $BASE/current already points at a directory, don't descend into it.
ln -sfn "$RELEASE_DIR" "${BASE}/current"

# ---------------------------------------------------------------------------
# 5. Restart the service
# ---------------------------------------------------------------------------

systemctl restart "$SERVICE"

# ---------------------------------------------------------------------------
# 6. Health gate — poll /health until 200 or timeout
# ---------------------------------------------------------------------------

# Read the port from the env file the service itself uses.
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: env file not found: $ENV_FILE — cannot determine port for health check" >&2
    exit 1
fi

PORT="$(grep -E '^MEMORY_FS_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]' || true)"
if [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
    echo "ERROR: MEMORY_FS_HTTP_PORT in $ENV_FILE is missing or not numeric: '${PORT}'" >&2
    exit 1
fi

HEALTH_URL="http://127.0.0.1:${PORT}/health"
echo "Polling ${HEALTH_URL} (timeout: ${HEALTH_TIMEOUT}s)..."

elapsed=0
healthy=false
while [[ $elapsed -lt $HEALTH_TIMEOUT ]]; do
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ "$status" == "200" ]]; then
        healthy=true
        break
    fi
    sleep "$HEALTH_INTERVAL"
    elapsed=$(( elapsed + HEALTH_INTERVAL ))
done

if [[ "$healthy" != "true" ]]; then
    echo "ERROR: health check failed after ${HEALTH_TIMEOUT}s (last HTTP status: ${status:-none})" >&2

    if [[ -n "$PREVIOUS_RELEASE" ]]; then
        echo "Rolling back to previous release: $PREVIOUS_RELEASE" >&2
        ln -sfn "$PREVIOUS_RELEASE" "${BASE}/current"
        if systemctl restart "$SERVICE"; then
            echo "Rollback complete. Deploy FAILED." >&2
        else
            echo "ERROR: rollback restart also failed — service may be down. Deploy FAILED." >&2
        fi
    else
        echo "No previous release to roll back to. Broken release left in place. Deploy FAILED." >&2
    fi

    exit 1
fi

echo "Health check passed."

# ---------------------------------------------------------------------------
# 7. Prune old releases — keep the N most recent, never remove current
# ---------------------------------------------------------------------------

CURRENT_RELEASE="$(readlink -f "${BASE}/current")"

# List release dirs sorted newest-first by modification time; skip the
# current release even if it falls outside the keep window.
mapfile -t all_releases < <(
    find "${BASE}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
        | sort -rn \
        | awk '{print $2}'
)

kept=0
for dir in "${all_releases[@]}"; do
    if [[ "$dir" == "$CURRENT_RELEASE" ]]; then
        # Always keep current regardless of its position in the list.
        kept=$(( kept + 1 ))
        continue
    fi
    if [[ $kept -lt $KEEP_RELEASES ]]; then
        kept=$(( kept + 1 ))
    else
        echo "Pruning old release: $dir"
        rm -rf "$dir"
    fi
done

echo "Deploy complete: $SHA"
