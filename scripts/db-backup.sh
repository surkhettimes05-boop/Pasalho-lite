#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$BACKUP_DIR/pasalho-${STAMP}.dump}"

pg_dump "$DATABASE_URL"   --format=custom   --no-owner   --no-privileges   --file="$OUT"

test -s "$OUT"
echo "Backup created: $OUT"
