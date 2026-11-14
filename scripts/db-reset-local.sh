#!/usr/bin/env bash
# Recreates a throwaway local database and applies the shim + all migrations.
# Usage: scripts/db-reset-local.sh [database-name]   (requires a superuser PG* environment)
set -euo pipefail
DB="${1:-capflow_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${ROOT}/supabase/tests/local_shim.sql"
for f in "${ROOT}"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "$f"
done
echo "database ${DB} ready"
