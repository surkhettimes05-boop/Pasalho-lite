#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

BACKUP_FILE="${1:?Usage: scripts/db-restore.sh <backup.dump>}"

if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "Backup file is missing or empty: $BACKUP_FILE" >&2
  exit 1
fi

pg_restore "$BACKUP_FILE"   --dbname="$RESTORE_DATABASE_URL"   --clean   --if-exists   --no-owner   --no-privileges

echo "Restore completed into configured RESTORE_DATABASE_URL."
