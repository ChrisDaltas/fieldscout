#!/usr/bin/env bash
#
# gate-m7.sh — the M7 gate, 2026 form (L.F2.12). The single entry point
# `npm run test:gate:m7`. It COMPOSES the existing proofs, never rewrites them
# (tasks-M7 §6 L.F2.12, §9's proof map; the L.D6.3 / L.E1.37 precedent).
#
#   [1/7]  Pre-flight: the CLI answers from this cwd inside 60 s; the stack it
#          names is 127.0.0.1; no ambient URL points elsewhere; the verdict
#          logic's own unit suite; the ledger by severity + the attachments as
#          they stand. Touches no data. Open S0 / S1 and missing attachments are
#          PRINTED here and judged at [7/7]; an unreadable ledger aborts now.
#   [2/7]  Fresh `supabase db reset` — the full chain, a pristine start for
#          M7's own legs (and it clears whatever a shared DB was holding).
#   [3/7]  M7's pgTAP BY NAME, on the empty post-reset pool: 156 + 157 (L.F2.8
#          G1–G4), 159 (rate limits, L.F2.6), 160 (L.F2.8's remaining groups),
#          162 (the archive, F716). The summary line must say Files=5, so a
#          run that found nothing is not a pass.
#   [4/7]  M7's vitest BY NAME (F84): the wire suites (rate limits, migration
#          210's hardening) and the unit pins behind them.
#   [5/7]  F56 settle → `npm run test:chaos` (F835) → settle after (F298).
#   [6/7]  `npm run test:gate:m6` — continuity: its own fresh reset + the FULL
#          pgTAP + the M6 vitest + the correction seasons + E2E + M5 → M0.
#          (`test:gate:m8` too, the day it exists — see below.)
#   [7/7]  The verdict: re-reads the ledger and the attachments, prints the
#          banner. Exit codes below.
#
# WHERE EACH PROOF LIVES:
#   Rate limits (§22.5)    pgTAP 159 at [3/7]; on the wire at [4/7].
#   Security (L.F2.8)      pgTAP 156, 157, 160 at [3/7]; wire + pins at [4/7].
#   Archive (F716)         pgTAP 162 at [3/7].
#   Chaos drills (L.F2.3)  [5/7] — the four drills' files are checked by name
#                          first, so a renamed drill can't go quietly missing.
#   Everything else in     `test:gate:m6` at [6/7].
#     pgTAP (FULL suite)
#   Continuity (§9)        `test:gate:m6` at [6/7].
#   Zero S0 / S1 (crit. 3) the ledger, [1/7] and [7/7] (TD6 = D575; the tags
#                          are read by `gate-m7-open-rows.ts`).
#
# THE FULL pgTAP SUITE RUNS ONLY INSIDE [6/7]. This gate does not run it again:
# [3/7] is the five M7 files for their own named stage, which costs seconds.
# Those five also run inside the full suite at [6/7] — and in every older gate.
#
# WHY THIS ORDER. M7's legs run first and on their own reset because they take
# minutes and [6/7] takes more than an hour, so a red M7 leg fails fast.
# [6/7] resets again as its first step, so chaos residue can't reach it. The
# drills are built for a fresh or shared DB (`chaos-f23` namespace, season 2072,
# swept before and after — D760); CI's Database job runs them on a fresh chain,
# which is the state here. They need realtime up, which a reset has just
# restarted, hence the settle first (its probe does a realtime round trip).
#
# THE HONEST VERDICT. Exit criteria 1, 2 and 4 are not scripts. Each needs a
# file holding its own line, at column 0, outside any code fence:
#   criterion 1  L.F2.2's results   docs/runbooks/evidence/L.F2.2-load-y2026.md
#                                   line: `M7-GATE-ATTACHMENT: L.F2.2 PASS`
#                                   (needs C1, the hosted test project)
#   criterion 2  L.F2.10's logs     docs/runbooks/evidence/L.F2.10-rehearsal-log.md
#                                   line: `M7-GATE-ATTACHMENT: L.F2.10 PASS`
#                                   (needs C1; TD5 — timestamped, executed)
#   criterion 4  the weekend + the  docs/runbooks/beta-ladder.md §6 (F761)
#                ruling             line: `M7-GATE-ATTACHMENT: C4 PASS`
#                                   (needs C4, then Chris's ruling — TD10)
# The line is added by whoever attaches the record, and only after the record
# says it: standing rule (f), a miss is Chris's to rule on. An absent file, an
# empty file, no line, or any word but PASS all read as NOT having it.
#
# EXIT:
#   0   M7 2026 GATE PASSED: every leg green, all three attachments, no rated
#       S0 / S1 open.
#   1   a test leg failed, whatever code the leg itself returned (the EXIT trap
#       maps it, so a leg's own 3 can never read as "automated legs green").
#   2   not runnable, nothing proven: CLI hung or stack down, an ambient
#       non-local URL, an unreadable ledger.
#   3   AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED: an attachment is missing.
#   4   same headline, and an S0 / S1 row is open (outranks 3); named row by row.
# As of L.F2.12's build, 3 or 4 is the EXPECTED result: C1 does not exist and C4
# has not happened. L.F2.12's box stays unticked until exit 0.
#
# Open rows with NO rating (most older rows) are counted and listed, never read
# as clean and never as failures. "Zero S0/S1" therefore covers rated rows only,
# and every banner says so (F861).
#
# `test:gate:m8` DOES NOT EXIST: M8's L.G2.2 is unticked and waits on the same
# C1. The banner prints that it did not run. When L.G2.2 adds the script, [6/7]
# runs it; if it composes `test:gate:m6` itself, drop the direct call then.
#
# The load runs at launch size (L.F2.13), the alerts (L.F2.4), the automatic
# trips (L.F2.5) and the outside review (L.F2.14) belong to the launch gate,
# L.F2.15 (TD9), not this one.
#
# LOCAL ONLY. `.env.local` points at production, so every stage is pinned:
#   db reset, test db       the CLI's local stack; [1/7] checks the URL it names.
#   vitest stack suites     hard-coded 127.0.0.1 defaults (D59(5)); none reads
#                           `.env.local`. The chaos drills' one child process,
#                           `scripts/reconcile.ts` (which has no guard of its
#                           own — gate-m4's header), is handed the local URL and
#                           key explicitly and must print the local URL back.
#   restore-dev.sh          exports the local URL + key before any seed script.
#   sim, sim:census         refuse any non-127.0.0.1 URL.
#   gate-settle.ts          local coordinates only; reads no `.env.local`.
#   gate-m*-evidence.ts     read report files; touch no database.
#   Playwright              pins `next dev` to the local stack; auth.setup.ts
#                           asserts the traffic landed on 127.0.0.1:54321.
#   restore-dev.sh also READS the free public player APIs (network needed).
# A git worktree holds no `.env.local` at all, which removes the risk outright.
#
# RUNNING IT — from the checkout it lives in, stack up, and only with the local
# DB to yourself (one local DB, one builder):
#     mkdir -p /tmp/gate-docker && echo '{}' > /tmp/gate-docker/config.json
#     DOCKER_CONFIG=/tmp/gate-docker npm run test:gate:m7 2>&1 | tee /tmp/gate-m7.log
#     # the exit code: ${PIPESTATUS[0]} in bash, ${pipestatus[1]} in zsh
# From a git worktree: the CLI answered from a worktree cwd on 2026-09-28,
# 2026-10-02 and (status only) 2026-11-03, but it has hung there before, and
# `--workdir` can't help because every composed gate cds into its own repo root
# and calls plain `npx supabase`. So [1/7] times the CLI and [2/7] times the
# reset, and a hang exits 2 at once instead of an hour in. If that happens, run
# the gate from a plain clone or the main checkout of the same commit.
#
# EXPECT 1.5–2 HOURS: [6/7] was 4,161 s on 2026-10-02 (D473) with a shorter
# chain, and M7's own legs add minutes. FLAKE POLICY: none of its own (the
# composed gates carry theirs). `set -euo pipefail`, no backgrounding, NO
# RETRIES. AFTER a run, re-create dev state with
# `RESTORE_SCOPE=draft npm run restore:dev`. `.gate-m7/` is gitignored.
#
# Check where things stand, without running anything or touching any database:
#     npx tsx scripts/gate-m7-evidence.ts status
set -euo pipefail

cd "$(dirname "$0")/.."

GATE_T0=$SECONDS
STAGE_T0=$SECONDS
stage() {
  STAGE_T0=$SECONDS
  CURRENT_STAGE="$1"
  echo ""
  echo "==> $1"
}
took() {
  echo "    [stage: $((SECONDS - STAGE_T0))s | elapsed: $((SECONDS - GATE_T0))s]"
}
# `alarm` survives `exec`, so the command dies at the budget (exit 142): a hung
# CLI must not read as a very long gate. Never use this inside `$(...)`: npx's
# child would hold the pipe open past the alarm.
with_budget() {
  local seconds="$1"
  shift
  perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$@"
}
# Exit 1 belongs to a failed test leg, whatever code the leg itself returned, so
# a stage that happens to exit 3 can never read as "automated legs green".
# Only the two deliberate exits below (not_runnable, the verdict) keep their code.
CURRENT_STAGE="(before the first stage)"
GATE_DECIDED=0
not_runnable() {
  echo "    NOT RUNNABLE: $1"
  echo "    Nothing has been proven."
  GATE_DECIDED=1
  exit 2
}
on_exit() {
  local code=$?
  [ "$GATE_DECIDED" -eq 1 ] && exit "$code"
  [ "$code" -eq 0 ] && exit 0
  echo ""
  echo "======================================================================"
  echo "  M7 2026 GATE FAILED — a test leg failed (exit $code) at:"
  echo "  $CURRENT_STAGE"
  echo "  TOTAL: $((SECONDS - GATE_T0))s"
  echo "======================================================================"
  exit 1
}
trap on_exit EXIT

echo "======================================================================"
echo "  M7 GATE, 2026 form (L.F2.12) — hardening: exit-criteria proof"
echo "======================================================================"
echo ""
echo "!! THIS RESETS THE LOCAL DB (several times — the composed M6 → M1 gates"
echo "!! reset too). User-created local data is DESTROYED. One local DB, one"
echo "!! builder: run it only with the DB to yourself."

REPORT_DIR=.gate-m7
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

# ---------------------------------------------------------------------------
# M7's named lists (F84: enumerated, never a glob, so a silent drop shows).
# ---------------------------------------------------------------------------
M7_PGTAP=(
  supabase/tests/156_function_grants_and_server_owned_columns.sql
  supabase/tests/157_list_players_list_id_and_start_sit_freeze.sql
  supabase/tests/159_rate_limits.sql
  supabase/tests/160_security_hardening_followups.sql
  supabase/tests/162_league_archive.sql
)
M7_VITEST=(
  src/lib/rate-limit/rate-limits-db.test.ts
  src/lib/security/hardening-wire-db.test.ts
  src/middleware-rate-limit.test.ts
  src/lib/rate-limit/route-limits.test.ts
  src/lib/rate-limit/rate-limit-refusal.test.ts
  src/lib/rate-limit/latest-value-sender.test.ts
  src/lib/auth/cron-secret.test.ts
  src/lib/auth/profile-columns.test.ts
  src/lib/storage-bucket-limits.test.ts
  src/app/auth/callback/route.test.ts
  src/utils/safe-redirect-path.test.ts
  src/utils/local-supabase-url.test.ts
)
CHAOS_DRILLS=(
  src/lib/leagues/chaos/realtime-kill-db.test.ts
  src/lib/leagues/chaos/provider-faults-db.test.ts
  src/lib/leagues/chaos/worker-crash-db.test.ts
  src/lib/leagues/chaos/waiver-run-failure-db.test.ts
)

stage "[1/7] Pre-flight — the CLI answers, the stack is local, the ledger parses"
command -v perl >/dev/null || not_runnable "perl is required for the CLI time budget"
for name in SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_LOCAL_URL; do
  value="${!name:-}"
  case "$value" in
    "" | http://127.0.0.1:* | http://localhost:*) ;;
    # The value is not printed: it may name the production host.
    *) not_runnable "$name is set to a non-local URL. Unset it; this gate is local only." ;;
  esac
done
# To a file, not `$(...)`: see with_budget. It holds the local stack's keys, so
# only its one URL line is read and the file goes straight away.
CLI_BUDGET_S="${GATE_M7_CLI_BUDGET_S:-60}"
cli_code=0
with_budget "$CLI_BUDGET_S" npx supabase status -o env >"$REPORT_DIR/cli-status.env" 2>/dev/null || cli_code=$?
stack_ok=0
grep -q '^API_URL="http://127.0.0.1:54321"' "$REPORT_DIR/cli-status.env" && stack_ok=1
rm -f "$REPORT_DIR/cli-status.env"
if [ "$cli_code" -ne 0 ]; then
  not_runnable "the Supabase CLI hung or the stack is down, from $(pwd) (exit $cli_code). Stack down: \`npx supabase start\`. Hung: run from a plain clone or the main checkout of the same commit (see this script's header)."
fi
[ "$stack_ok" -eq 1 ] || not_runnable "the CLI's stack does not answer on http://127.0.0.1:54321."
echo "    CLI answered; stack is http://127.0.0.1:54321"
for file in "${M7_PGTAP[@]}" "${M7_VITEST[@]}" "${CHAOS_DRILLS[@]}"; do
  [ -f "$file" ] || { echo "    MISSING: $file — this gate's named list is out of date"; exit 1; }
done
npx vitest run scripts/gate-m7-open-rows.test.ts scripts/gate-m7-wiring.test.ts
set +e
npx tsx scripts/gate-m7-evidence.ts status --out "$REPORT_DIR"
preflight=$?
set -e
case "$preflight" in
  0 | 3 | 4) ;;
  *) not_runnable "the ledger or the verdict logic could not be read (exit $preflight)." ;;
esac
took

stage "[2/7] Fresh local stack reset (pristine, fully-migrated chain)"
reset_code=0
with_budget "${GATE_M7_RESET_BUDGET_S:-900}" npx supabase db reset || reset_code=$?
[ "$reset_code" -ne 142 ] || not_runnable "\`supabase db reset\` hung past its budget, from $(pwd). See this script's header."
[ "$reset_code" -eq 0 ] || exit "$reset_code"
took

stage "[3/7] M7's pgTAP by name — 156, 157, 159, 160, 162, on the empty pool"
npx supabase test db "${M7_PGTAP[@]}" 2>&1 | tee "$REPORT_DIR/pgtap-m7.txt"
grep -Eq "^Files=${#M7_PGTAP[@]}," "$REPORT_DIR/pgtap-m7.txt" || {
  echo "    pg_prove's summary does not say Files=${#M7_PGTAP[@]} — the named files did not all run."
  exit 1
}
took

stage "[4/7] M7's vitest by name — ${#M7_VITEST[@]} files (wire suites + the unit pins behind them)"
npx vitest run "${M7_VITEST[@]}"
took

stage "[5/7] F56 settle → the chaos drills (test:chaos, F835) → settle (F298)"
npx tsx scripts/gate-settle.ts
npm run test:chaos
npx tsx scripts/gate-settle.ts
took

stage "[6/7] M6 gate — continuity (own reset + FULL pgTAP + M6 vitest + seasons + E2E + M5 → M0)"
npm run test:gate:m6
m8_state=absent
if [ -n "$(node -p "require('./package.json').scripts['test:gate:m8'] || ''")" ]; then
  npm run test:gate:m8
  m8_state=ran
fi
took

stage "[7/7] The verdict — the ledger and the attachments, read again"
# Reaching this line means every stage above passed under `set -e`, so this is
# the only caller of `verdict`. Its exit code is the gate's.
set +e
npx tsx scripts/gate-m7-evidence.ts verdict --m8 "$m8_state" --elapsed "$((SECONDS - GATE_T0))" --out "$REPORT_DIR"
verdict=$?
set -e
GATE_DECIDED=1
exit "$verdict"
