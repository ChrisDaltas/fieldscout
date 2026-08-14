#!/usr/bin/env bash
# ============================================================================
# Restore the LOCAL dev environment after a `supabase db reset`.
#
#   npm run restore:dev
#
# A reset keeps migrations + their seeds (scoring templates) and — via
# supabase/seed.sql — the two dev auth users. Everything else (players,
# personas, projections, research data, historical stats) is re-synced here.
#
# WHY THE ENV OVERRIDES: every seed/sync script loads .env.local, which points
# at the HOSTED Supabase project. Without these exports a "recovery" silently
# writes to production. dotenv never overrides pre-set env vars, so exporting
# the local URL + service key first pins every child script to the local
# stack (other .env.local vars, e.g. ANTHROPIC_API_KEY, still load normally).
#
# Deliberately NOT run: sync:mock-stats — the 2026 current-season stats table
# stays intentionally empty for the clean preseason.
#
# User-created data (leagues, avatars, team names) is NOT restorable —
# recreate leagues via the create-league modal.
#
# RESTORE_SCOPE (L.B7.1 — the M2 gate's mid-gate restore):
#   full  (default) — everything below, INCLUDING the paid persona seeding.
#   draft           — only what a draft needs: dev users + players +
#                     projections + bye weeks. No personas (paid Anthropic
#                     calls — D117(9)), no research data, no historical
#                     stats. `scripts/gate-m2.sh` uses this between its
#                     fresh reset and the pool-dependent sim/E2E stages
#                     (the F47/D124(9) recorded procedure, scoped to what
#                     those stages actually consume).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

RESTORE_SCOPE="${RESTORE_SCOPE:-full}"
case "$RESTORE_SCOPE" in
  full|draft) ;;
  *) echo "RESTORE_SCOPE must be 'full' or 'draft' (got '$RESTORE_SCOPE')" >&2; exit 2 ;;
esac

SERVICE_ROLE_KEY=$(npx supabase status 2>/dev/null | python3 -c '
import json, re, sys
raw = sys.stdin.read()
try:
    print(json.loads(raw)["SERVICE_ROLE_KEY"])
except Exception:
    m = re.search(r"service_role key: (\S+)", raw)
    if not m:
        sys.exit("could not parse SERVICE_ROLE_KEY from supabase status — is the local stack running?")
    print(m.group(1))
')

export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

echo "== dev users (idempotent double-check of supabase/seed.sql)"
npx tsx scripts/seed-dev-user.ts

echo "== players"
npx tsx scripts/sync-players.ts

if [ "$RESTORE_SCOPE" = "full" ]; then
  echo "== AI personas (makes Anthropic API calls for the expert lists)"
  npx tsx scripts/seed-ai-personas.ts
fi

echo "== projections / bye weeks"
npx tsx scripts/sync-projections.ts
npx tsx scripts/sync-bye-weeks.ts

if [ "$RESTORE_SCOPE" = "full" ]; then
  echo "== research data (usage / splits / auction / SOS)"
  npx tsx scripts/sync-season-usage.ts
  npx tsx scripts/sync-splits.ts
  npx tsx scripts/sync-auction.ts
  npx tsx scripts/sync-sos.ts

  echo "== historical stats (2025)"
  python3 scripts/load-historical-stats.py
fi

echo
echo "Done (scope: $RESTORE_SCOPE). Dev login: dev@fieldscout.local / dev-password-1234"
echo "Not run on purpose: sync:mock-stats (clean-preseason rule)."
