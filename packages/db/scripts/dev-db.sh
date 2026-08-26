#!/usr/bin/env bash
#
# Spins up a disposable Postgres with every migration applied, and — unlike
# tests/sql/run.sh, which tears its instance down on exit — leaves it
# running, so generate-types.mjs (or anything else that needs a live
# connection) has something to point at.
#
# Usage:
#   su postgres -c 'bash packages/db/scripts/dev-db.sh'
#   node packages/db/scripts/generate-types.mjs "postgresql://postgres@127.0.0.1:54395/aec_dev"
#   # when done:
#   /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/aec-devdb/pgdata -m immediate stop
#
# Postgres refuses to run as root — if this shell is root, call it through
# another user the way tests/sql/run.sh's own header documents.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_DEV:-54395}"
WORKDIR="${PGDEV_DIR:-${TMPDIR:-/tmp}/aec-devdb}"
PGDATA="$WORKDIR/pgdata"
DB=aec_dev

rm -rf "$WORKDIR"
mkdir -p "$PGDATA"

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $WORKDIR" -l "$WORKDIR/pg.log" -w start >/dev/null

export PGHOST="$WORKDIR" PGPORT="$PORT" PGUSER=postgres

psql -q -c "create database $DB;" postgres
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "create extension if not exists pgcrypto;"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/tests/sql/00_supabase_stub.sql"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  # psql's own exit code is checked directly, before any filtering — piping
  # straight into `grep -v ... || true` would let a real migration error
  # through silently: the `|| true` forces the pipeline to exit 0 no matter
  # what psql did, so a syntax/constraint error would apply cleanly on
  # paper while generate-types.mjs went on to introspect a database
  # silently missing whatever that migration was supposed to add.
  if ! output=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$migration" 2>&1); then
    echo "$output" >&2
    echo "Migration failed: $migration" >&2
    exit 1
  fi
  [ -z "$output" ] || echo "$output" | grep -v 'already exists, skipping' || true
done

echo ""
echo "READY: postgresql://postgres@127.0.0.1:$PORT/$DB"
echo "Stop with: $PGBIN/pg_ctl -D $PGDATA -m immediate stop"
