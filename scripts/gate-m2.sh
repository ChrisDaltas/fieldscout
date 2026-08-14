#!/usr/bin/env bash
#
# gate-m2.sh — the M2 milestone gate (L.B7.1). Proves every tasks-M2 §1 exit
# criterion in ONE run and is the single entry point `npm run test:gate:m2`.
#
# Composition (tasks-M2 §6 L.B7.1 item 1; the L.A1.16 precedent — the gate
# COMPOSES the existing proofs, it never rewrites them):
#   [1/7] Fresh `supabase db reset` — a pristine, fully-migrated chain (the
#         FULL chain, 001–082: 073–081 landed after 072 via the production
#         reconciliation + the Lists-v2 exceptions; 082 is this task's F54
#         RPC). A reset-clean gate cannot pass on residue or a drifted DB.
#   [2/7] `npm run test:db` — the FULL pgTAP suite (000–031; 019–026 + 031
#         are the M2 files, incl. 025's mock zero-side-effect diff and 023's
#         commissioner-control matrix).
#   [3/7] vitest -c vitest.gate-m2.config.ts — draft-core / draft-tick /
#         draft-commish-api (the mock lifecycle) DB suites + the D90
#         order-parity fixture, serialized (the F52 discipline).
#   [3.5]  Draft-scope data restore (RESTORE_SCOPE=draft, local-pinned) —
#         the sim and the E2E suite draft the REAL local pool (D123(11)/
#         R286: no fixture ADP band is safe by construction) and the reset
#         at [1/7] emptied it. Exactly the F47/D124(9) recorded procedure,
#         scoped to what the pool-dependent stages consume (players +
#         projections + byes; personas stay unrestored — paid, D117(9)).
#   [4/7] The L.B6.1 League-Simulator gate run — 25 concurrent bot snake
#         drafts, mixed sizes incl. 16-team, chaos persona throughout,
#         seed 42 (the batch-18 replay seed): zero duplicate picks, zero
#         stuck clocks, zero invariant failures — §1 criterion 2. Post-F54
#         the chaos double-taps must also reproduce ZERO interleaves.
#   [5/7] `npm run test:e2e` — the L.B5.1 Playwright suite: the full live
#         draft (a), reconnect < 2s (b — §1 criterion 3), the solo mock
#         with the zero-league-writes DB diff (c — §1 criterion 4), and the
#         Phase A journey (d). §1 criterion 1's browser half.
#   [6/7] `npm run test:gate:m1` — M1 continuity (its own fresh reset +
#         full pgTAP + the M1 vitest gate + the M0 gate). F49 NOTE: this
#         composition is exactly why the fixture-instant sweep landed first
#         — the M1 suites' committed instants are 2028 now, so the live
#         draft-tick cron can never flip a suite league mid-run.
#   [7/7] `npm run test:gate` — M0 continuity (paranoia: [6/7] already ran
#         it; the task text names both, and it is cheap).
#
# `set -euo pipefail` + no `&`/subshell swallowing: ANY partial failure
# aborts with that stage's non-zero exit (a partial pass must fail the whole
# command). Requires the local Supabase stack up (`supabase start`) and
# network for stage [3.5]'s free sync APIs; a down stack fails loudly at
# [1/7], never skips (§4.3; D59(5)).
#
# AFTER a gate run the local DB holds only migration seeds + the draft-scope
# restore from [6/7]'s reset — NOTHING ELSE. Re-create the local dev state
# per ACTIVE-BUILD before browser work: full `npm run restore:dev` (or
# RESTORE_SCOPE=draft) + the three Lists-v2 fixtures (R215 saved-list, R219
# round-board, R247 player_count drift check).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "======================================================================"
echo "  M2 GATE (L.B7.1) — exit-criteria proof over the FULL migration chain"
echo "======================================================================"

echo ""
echo "==> [1/7] Fresh local stack reset (pristine, fully-migrated chain 001-082)"
npx supabase db reset

echo ""
echo "==> [2/7] Full pgTAP suite — test:db (019-026 + 031 are the M2 files)"
npm run test:db

echo ""
echo "==> [3/7] M2 vitest gate — draft-core/tick/commish+mock DB suites + D90 parity"
npx vitest run -c vitest.gate-m2.config.ts

echo ""
echo "==> [3.5] Draft-scope data restore (local-pinned; the sim/E2E pool)"
RESTORE_SCOPE=draft bash scripts/restore-dev.sh

echo ""
echo "==> [4/7] League Simulator — 25 concurrent bot snake drafts (seed 42)"
npm run sim -- draft --leagues 25 --clock 30 --seed 42

echo ""
echo "==> [5/7] Playwright E2E — live draft / reconnect < 2s / solo mock / journey"
npm run test:e2e

echo ""
echo "==> [6/7] M1 gate — continuity (own fresh reset + pgTAP + M1 vitest + M0)"
npm run test:gate:m1

echo ""
echo "==> [7/7] M0 gate — continuity"
npm run test:gate

echo ""
echo "======================================================================"
echo "  M2 GATE PASSED — every tasks-M2 §1 exit criterion green"
echo "======================================================================"
