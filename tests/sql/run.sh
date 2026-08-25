#!/usr/bin/env bash
#
# Sobe um Postgres descartavel, aplica todas as migrations e roda os testes de
# schema. Nao precisa de Docker nem do Supabase CLI — so do Postgres instalado.
#
#   ./tests/sql/run.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54399}"
WORKDIR="${PGTEST_DIR:-${TMPDIR:-/tmp}/aec-pgtest}"
PGDATA="$WORKDIR/pgdata"
DB=aec_test

cleanup() {
  if [ -d "$PGDATA" ]; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

rm -rf "$WORKDIR"
mkdir -p "$PGDATA"

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $WORKDIR" -l "$WORKDIR/pg.log" -w start >/dev/null

export PGHOST="$WORKDIR" PGPORT="$PORT" PGUSER=postgres

psql -q -c "create database $DB;" postgres
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "create extension if not exists pgcrypto;"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/tests/sql/00_supabase_stub.sql"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$migration" 2>&1 \
    | grep -v 'already exists, skipping' || true
done

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/tests/sql/10_schema_test.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]*: NOTICE:  //' -e '/^NOTICE:  /s/^NOTICE:  //'
