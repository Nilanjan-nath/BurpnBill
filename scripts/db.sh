#!/usr/bin/env bash
# Apply a .sql file to the Supabase database named by DATABASE_URL in .env
#
#   scripts/db.sh init      # the schema migration (skipped if already applied)
#   scripts/db.sh seed      # demo cafe + menu, prints QR tokens
#   scripts/db.sh verify    # invariant checks (rolls back, changes nothing)
#   scripts/db.sh status    # which migrations have been applied
#   scripts/db.sh path/to/other.sql
#
# Files under supabase/migrations/ are recorded in public.schema_migrations and
# applied at most once. Everything else is applied every time it is asked for.

set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env found. Copy .env.example to .env and set DATABASE_URL." >&2; exit 1; }

# Read DATABASE_URL without sourcing .env -- an unfilled placeholder or an
# unquoted special character would otherwise be executed by the shell.
DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL=//p' .env | tail -1 | tr -d '\r' \
  | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"

[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is empty in .env" >&2; exit 1; }
case "$DATABASE_URL" in
  *'<'*|*'>'*|*YOUR-PASSWORD*)
    echo "DATABASE_URL still contains a placeholder. Paste the Session pooler string from the Supabase dashboard." >&2
    exit 1 ;;
esac

PSQL="$(command -v psql || true)"
[ -n "$PSQL" ] || PSQL=/opt/homebrew/opt/postgresql@17/bin/psql
[ -x "$PSQL" ] || { echo "psql not found" >&2; exit 1; }

run() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"; }

ensure_ledger() {
  run -q -c "set client_min_messages = warning" \
          -c "create table if not exists public.schema_migrations (
               version text primary key,
               applied_at timestamptz not null default now()
             )" -c "alter table public.schema_migrations enable row level security"
}

case "${1:-}" in
  init)   FILE=supabase/migrations/20260919090000_init.sql ;;
  seed)   FILE=supabase/seed.sql ;;
  verify) FILE=scripts/verify_schema.sql ;;
  status)
    ensure_ledger
    run -c "select version, applied_at from public.schema_migrations order by version"
    exit 0 ;;
  "")     echo "usage: scripts/db.sh {init|seed|verify|status|<file.sql>}" >&2; exit 1 ;;
  *)      FILE="$1" ;;
esac

[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

case "$FILE" in
  supabase/migrations/*)
    VERSION="$(basename "$FILE" .sql)"
    ensure_ledger
    if [ -n "$(run -qtAc "select 1 from public.schema_migrations where version = '$VERSION'")" ]; then
      echo "already applied: $VERSION  (nothing to do)"
      exit 0
    fi
    echo "--> applying $FILE"
    run -f "$FILE"
    run -q -c "insert into public.schema_migrations (version) values ('$VERSION')"
    echo "recorded: $VERSION"
    ;;
  *)
    echo "--> applying $FILE"
    run -f "$FILE"
    ;;
esac
