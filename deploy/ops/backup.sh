#!/usr/bin/env bash
# Daily Postgres backup for production (docs/production-runbook.md). Run from cron on the VPS.
# Writes a compressed dump, keeps 30 days locally, copies it off the server with rclone and pings
# a dead-man's-switch check on success. Postgres holds agents, receipts and referral credits;
# Redis is not backed up (docs/production-plan.md, "Backups").
#
# Configuration (environment, e.g. /etc/m2m-backup.env):
#   M2M_PG_SERVICE        Docker Swarm service of the production Postgres (Easypanel: <project>_<db>)
#   M2M_PG_USER, M2M_PG_DB  Database user and name (no password needed inside the container)
#   M2M_BACKUP_DIR        Local directory (default /var/backups/m2m)
#   M2M_RCLONE_REMOTE     rclone destination off the server, e.g. offsite:m2m-backups
#   M2M_BACKUP_PING_URL   Ping URL of the backup check (healthchecks-style)
#   M2M_RETENTION_DAYS    Default 30 (local and remote)
set -euo pipefail

: "${M2M_PG_SERVICE:?}" "${M2M_PG_USER:?}" "${M2M_PG_DB:?}" "${M2M_RCLONE_REMOTE:?}"
: "${M2M_BACKUP_PING_URL:?}"
DIR="${M2M_BACKUP_DIR:-/var/backups/m2m}"
DAYS="${M2M_RETENTION_DAYS:-30}"
FILE="$DIR/m2m-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

fail() { curl -fsS -m 10 --retry 3 --data-raw "$1" "$M2M_BACKUP_PING_URL/fail" >/dev/null || true; exit 1; }
trap 'fail "backup failed at line $LINENO"' ERR

mkdir -p "$DIR"
container="$(docker ps -q -f "name=${M2M_PG_SERVICE}." | head -1)"
[[ -n "$container" ]] || fail "no running container for $M2M_PG_SERVICE"

docker exec "$container" pg_dump -U "$M2M_PG_USER" -d "$M2M_PG_DB" --no-owner --format=plain |
  gzip -9 >"$FILE.part"
gzip -t "$FILE.part"
mv "$FILE.part" "$FILE"

rclone copy "$FILE" "$M2M_RCLONE_REMOTE"
find "$DIR" -maxdepth 1 -name 'm2m-*.sql.gz' -mtime +"$DAYS" -delete
rclone delete --min-age "${DAYS}d" "$M2M_RCLONE_REMOTE"

curl -fsS -m 10 --retry 3 "$M2M_BACKUP_PING_URL" >/dev/null
