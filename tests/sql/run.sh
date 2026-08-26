#!/usr/bin/env bash
#
# Sobe um Postgres descartavel, aplica todas as migrations e roda os testes de
# schema. Nao precisa de Docker nem do Supabase CLI — so do Postgres instalado.
#
#   ./tests/sql/run.sh
#
# O Postgres recusa rodar como root. Se voce for root, chame por outro usuario:
#   su postgres -c 'PGTEST_DIR=/tmp/aec-pgtest bash tests/sql/run.sh'
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
  # psql's own exit code is checked before any filtering — piping straight
  # into `grep -v ... || true` would let a real migration error through
  # silently, since `|| true` forces the whole pipeline to exit 0
  # regardless of what psql did.
  if ! output=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$migration" 2>&1); then
    echo "$output" >&2
    echo "Migration failed: $migration" >&2
    exit 1
  fi
  # `echo` always emits a line, even for an empty $output — most migrations
  # print nothing at all, and without this guard every one of them would
  # add a spurious blank line (grep -v doesn't drop it: an empty line
  # doesn't contain "already exists, skipping" either).
  [ -z "$output" ] || echo "$output" | grep -v 'already exists, skipping' || true
done

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/tests/sql/10_schema_test.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]*: NOTICE:  //' -e '/^NOTICE:  /s/^NOTICE:  //'

# Os seeds sao aplicados em um banco limpo, separado dos testes: eles precisam
# rodar sem erro em producao-de-mentira, e um seed quebrado so apareceria quando
# alguem novo tentasse subir o projeto.
echo ""
echo "== Seeds de desenvolvimento =="
psql -q -c "create database ${DB}_seed;" postgres
psql -v ON_ERROR_STOP=1 -q -d "${DB}_seed" -c "create extension if not exists pgcrypto;"
psql -v ON_ERROR_STOP=1 -q -d "${DB}_seed" -f "$ROOT/tests/sql/00_supabase_stub.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  if ! output=$(psql -v ON_ERROR_STOP=1 -q -d "${DB}_seed" -f "$migration" 2>&1); then
    echo "$output" >&2
    echo "Migration failed: $migration" >&2
    exit 1
  fi
  [ -z "$output" ] || echo "$output" | grep -v 'already exists, skipping' || true
done
psql -v ON_ERROR_STOP=1 -q -d "${DB}_seed" -f "$ROOT/supabase/seed.sql" > /dev/null
psql -q -t -d "${DB}_seed" -c "
  select '  ok: ' || count(*) || ' lancamentos, ' ||
         (select count(*) from public.bank_accounts) || ' contas, ' ||
         (select count(*) from public.companies) || ' empresas'
    from public.transactions;
  select '  ok: saldo consolidado da primeira empresa: R$ ' ||
         round(sum(current_balance), 2)::text
    from public.v_account_balances
   where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
"
