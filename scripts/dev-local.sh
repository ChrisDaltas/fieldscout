#!/usr/bin/env bash
# ============================================================================
# Start the Next dev server against the LOCAL Supabase stack.
#
#   bash scripts/dev-local.sh            # port 3123
#   bash scripts/dev-local.sh 3124       # any port
#
# WHY THIS EXISTS: `.env.local` points at HOSTED production, so a bare
# `npm run dev` drives the real users' database. The overrides below pin the
# app to the local stack. They are read from `supabase status` rather than
# pasted, because a hand-copied anon key is how you get
# "Failed to read the 'headers' property from 'RequestInit': String contains
# non ISO-8859-1 code point" — a smart quote or non-breaking space picked up
# from a rendered code block.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-3123}"

if ! docker ps --format '{{.Names}}' | grep -q supabase_db; then
  echo "The local Supabase stack isn't running. Start it first:" >&2
  echo "    npx supabase start" >&2
  exit 1
fi

eval "$(npx supabase status -o env | sed 's/^/export /')"

echo "→ local stack: $API_URL"
echo "→ dev server:  http://localhost:$PORT"
echo

rm -rf .next

NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_URL="$API_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npm run dev -- --port "$PORT"
