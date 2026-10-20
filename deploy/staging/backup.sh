#!/usr/bin/env bash
# Daily logical backup of the hosted WorkPulse database (T25 backup option B).
#
# Follows Supabase's CLI backup method: roles, schema and data dumps, restored
# with psql in that order. Storage objects (evidence, CV files) are NOT included.
#
# Usage: backup.sh            prune, then dump now
# Env file: backup.env next to this script, mode 600, with
#   WORKPULSE_BACKUP_DB_URL   session pooler URL, percent-encoded password
#   WORKPULSE_BACKUP_DIR      optional, default <script dir>/backups
#
# Exit 0 ok, 1 prune or dump failed. Output has no URL, password or row content.
set -euo pipefail
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/backup.env"
[ -r "$env_file" ] || { echo "$(date -u +%FT%TZ) backup: missing $env_file"; exit 1; }
# shellcheck disable=SC1090
. "$env_file"
: "${WORKPULSE_BACKUP_DB_URL:?set WORKPULSE_BACKUP_DB_URL in backup.env}"
backup_dir="${WORKPULSE_BACKUP_DIR:-$here/backups}"

# Copies older than this are deleted. With a daily run no copy reaches 30 days,
# which is the limit the S12 account deletion copy promises.
keep_days=29

mkdir -p "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) backup: previous run still active"; exit 1; }

# Prune before dumping, so a dump that keeps failing cannot keep old copies past
# 30 days. Leftover .partial-* dirs come from runs that were killed mid-dump.
find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$((keep_days - 1))" -exec rm -rf {} +
find "$backup_dir" -mindepth 1 -maxdepth 1 -type f -name 'failed-*.err' -mtime +"$((keep_days - 1))" -delete
find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' -mtime +0 -exec rm -rf {} +

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$backup_dir/.partial-$stamp"
trap 'rm -rf "$work"' EXIT
mkdir "$work"

dump() {
  local name="$1"; shift
  supabase db dump --db-url "$WORKPULSE_BACKUP_DB_URL" "$@" -f "$work/$name.sql" >/dev/null 2>"$work/$name.err" || {
    echo "$(date -u +%FT%TZ) backup: $name dump failed (see $backup_dir/failed-$stamp-$name.err)"
    # pg_dump errors can echo the connection target; keep them out of the shared log.
    mv "$work/$name.err" "$backup_dir/failed-$stamp-$name.err"
    exit 1
  }
  rm -f "$work/$name.err"
  [ -s "$work/$name.sql" ] || { echo "$(date -u +%FT%TZ) backup: $name dump is empty"; exit 1; }
  gzip -9 "$work/$name.sql"
}

dump roles --role-only
dump schema
dump data --data-only --use-copy

(cd "$work" && sha256sum ./*.sql.gz > SHA256SUMS)
mv "$work" "$backup_dir/$stamp"
trap - EXIT

size="$(du -sh "$backup_dir/$stamp" | cut -f1)"
count="$(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | wc -l)"
echo "$(date -u +%FT%TZ) backup: ok $stamp size=$size copies=$count"
