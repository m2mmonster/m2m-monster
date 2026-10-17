#!/usr/bin/env bash
# Minimal production monitor (docs/production-plan.md, "Monitoring and alerts"). Run from cron on
# the VPS every 5 minutes. It reads the API request log (D44, D60), disk usage and the age of the
# newest Postgres backup, then pings one dead-man's-switch check: success when all is fine,
# /fail with the reasons otherwise. A dead cron stops the pings, so the check alerts too.
#
# Configuration (environment, e.g. /etc/m2m-monitor.env; no secrets other than the ping URL):
#   M2M_APP_SERVICE     Docker Swarm service of the production app (Easypanel: <project>_<app>)
#   M2M_HEALTHCHECK_URL Ping URL of the monitor check (healthchecks-style)
#   M2M_DATA_PATH       Mount point to watch (default /)
#   M2M_BACKUP_DIR      Directory of the local backups written by backup.sh (default /var/backups/m2m)
# Thresholds (optional): M2M_MAX_5XX=5, M2M_MAX_SIM_FAILED=10, M2M_MAX_429=100, M2M_MAX_DISK=80,
#   M2M_MAX_BACKUP_AGE_H=26, M2M_WINDOW=5m
set -euo pipefail

: "${M2M_APP_SERVICE:?set M2M_APP_SERVICE}"
: "${M2M_HEALTHCHECK_URL:?set M2M_HEALTHCHECK_URL}"
DATA_PATH="${M2M_DATA_PATH:-/}"
BACKUP_DIR="${M2M_BACKUP_DIR:-/var/backups/m2m}"
WINDOW="${M2M_WINDOW:-5m}"

problems=()

# Request log lines are compact JSON: {"t":...,"status":500,...} and, on errors, "code":"...".
if logs="$(docker service logs --raw --since "$WINDOW" "$M2M_APP_SERVICE" 2>/dev/null)"; then
  count() { grep -c -E "$1" <<<"$logs" || true; }
  n5xx="$(count '"status":5[0-9]{2}[,}]')"
  nsim="$(count '"code":"SIMULATION_FAILED"')"
  n429="$(count '"status":429[,}]')"
  ((n5xx >= ${M2M_MAX_5XX:-5})) && problems+=("$n5xx responses >= 500 in $WINDOW")
  ((nsim >= ${M2M_MAX_SIM_FAILED:-10})) && problems+=("$nsim SIMULATION_FAILED in $WINDOW")
  ((n429 >= ${M2M_MAX_429:-100})) && problems+=("$n429 RATE_LIMITED in $WINDOW")
else
  problems+=("cannot read logs of service $M2M_APP_SERVICE")
fi

disk="$(df -P "$DATA_PATH" | awk 'NR==2 { sub("%", "", $5); print $5 }')"
((disk > ${M2M_MAX_DISK:-80})) && problems+=("disk $DATA_PATH at ${disk}%")

newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'm2m-*.sql.gz' -printf '%T@\n' 2>/dev/null |
  sort -n | tail -1)"
if [[ -z "$newest" ]]; then
  problems+=("no backup in $BACKUP_DIR")
else
  age_h=$((($(date +%s) - ${newest%.*}) / 3600))
  ((age_h >= ${M2M_MAX_BACKUP_AGE_H:-26})) && problems+=("newest backup is ${age_h} h old")
fi

if ((${#problems[@]})); then
  printf '%s\n' "${problems[@]}" >&2
  printf '%s\n' "${problems[@]}" | curl -fsS -m 10 --retry 3 --data-binary @- \
    "$M2M_HEALTHCHECK_URL/fail" >/dev/null
  exit 1
fi
curl -fsS -m 10 --retry 3 "$M2M_HEALTHCHECK_URL" >/dev/null
