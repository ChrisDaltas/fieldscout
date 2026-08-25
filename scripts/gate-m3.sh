#!/usr/bin/env bash
#
# gate-m3.sh — the M3 milestone gate (L.C6.1). Proves every tasks-M3 §1 exit
# criterion in ONE run and is the single entry point `npm run test:gate:m3`.
#
# Composition (tasks-M3 §6 L.C6.1 item 1; the L.A1.16/L.B7.1 precedent — the
# gate COMPOSES the existing proofs, it never rewrites them; F84 — every
# lane suite is enumerated BY NAME, never by glob):
#   [1/9] Fresh `supabase db reset` — the pristine, fully-migrated chain
#         (001–102 as of L.C6.1: 083–097 are the M3/AP/MP band, 098–102 the
#         AP/MS tail). A reset-clean gate cannot pass on residue or drift.
#   [2/9] `npm run test:db` — the FULL pgTAP suite (000–050). 032–038 are
#         the M3 engine files; 039–041/046–047 the AP lane; 042–045 the MP
#         lane; 048–050 the MS lane. The migrations are the schema's
#         certification, and pgTAP runs each file in a rolled-back txn.
#         D144(5) ORDERING CONSTRAINT, PINNED HERE (R308): this stage
#         requires the EMPTY post-reset player pool — 022/025/026's
#         autopick fixtures assert fixture ids and go RED against real pool
#         ids (10 failures observed). It therefore runs BEFORE [3.5]'s
#         restore, and a session that re-runs `test:db` AFTER a restore
#         (or after a vitest run leaves `vitest-%` players — F94/F127)
#         should expect reds that are ordering artifacts, not regressions.
#   [3/9] vitest -c vitest.gate-m3.config.ts — 36 files, enumerated by name
#         in that config (F84): the 8 M3 engine stack suites, the
#         derivation-parity fixture + the property test's PURE layer, the
#         3 sim unit suites, AP's 4, MP's 13, the 2 MP-extended room
#         suites, MS's 3, and L.C5.1's client-fix pin home. Serialized
#         (the F52 discipline).
#   [3.5] Draft-scope data restore (RESTORE_SCOPE=draft, local-pinned) —
#         the other half of D144(5): the sim and the E2E suite draft the
#         REAL local pool (D123(11)/R286: no fixture ADP band is safe by
#         construction for THEM) and the reset at [1/9] emptied it. The
#         two suites cannot both be green in the same DB state, so the
#         canonical order is reset → test:db → restore → everything
#         pool-dependent — exactly as gate-m2.sh stages it.
#   [3.6] THE property test, DB layer (auction-solvency-property-db) — the
#         37th enumerated suite, run on the RESTORED pool. Its own loud
#         premise (`pool.length > 64` real non-K/DEF players — F94's
#         never-let-nothing-mean-worked shape) red-lit the gate's FIRST
#         composed run when it sat pre-restore in [3/9]: the suite drafts
#         the REAL pool, so it is D144(5)-restored-side exactly like the
#         sim and E2E stages. Runs under the root config's stack project
#         (serialized).
#   [4/9] The L.C4.1 25-league AUCTION sim gate run — the F84-recorded
#         literal: mixed sizes incl. 16-team, five auction personas incl.
#         the T-1s sniper and chaos double-taps, ≥1 all-afk league, seed 42
#         (the L.C4.1 replay seed): zero duplicate players, zero stuck
#         clocks (both clock kinds, grace-aware), all `in_season`, rosters
#         full, SOLVENCY NEVER VIOLATED, budget conservation exact
#         (§1 criterion 1's engine half + criterion 2's runtime sweep).
#   [4.5] The F56 bounded stack-health settle (scripts/gate-settle.ts) —
#         the row's own recommendation, built at L.C6.1: poll until N=5
#         consecutive OK draft-state responses (200 + <400ms) with a 120s
#         budget, every sample logged. A diagnosed wait, never a blind
#         sleep: the E2E stage twice choked when started ~60–90s after the
#         sim's broadcast burst (F56 / R400's two-run evidence), and this
#         stage either proves the stack has settled or fails the gate with
#         the sample trail.
#   [5/9] `npm run test:e2e` — ONE Playwright run over the whole suite: the
#         L.C5.1 auction trio (auction-live / auction-storm — §1 criterion
#         3 — / mock-auction) + the M2 five (draft-live, reconnect < 2s,
#         mock-draft, cold-load, journey).
#   [6/9] `npm run test:gate:m2` — M2 continuity (its own fresh reset +
#         full pgTAP + the M2 vitest gate + the snake sim + E2E + M1 + M0).
#   [7/9] `npm run test:gate:m1` — M1 continuity ([6/9] already ran it; the
#         task text names both, and paranoia is cheap — the L.B7.1 shape).
#   [8/9] `npm run test:gate` — M0 continuity (same note).
#   [9/9] Banner. §1 criterion 4 (continuity) is [6]–[8]; criteria 1–3 are
#         [2]+[3]+[4]+[5] composed (the §8 proof map).
#
# FLAKE POLICY (the F113/F132 doctrine — a red is investigated against the
# NAMED mechanisms, never blanket-retried; an UNNAMED red FAILS the gate):
#   - F113 (two CLOSED mechanisms, auction-api-db + standalone-actions-db):
#     the cron-pass race and the ladder ratchet — both fixed by the D254(3)
#     freeze; a red at those lines today is NOT F113.
#   - F132 (OPEN): a third mechanism at auction-api-db's "launcher bids FOR
#     the human seat" line — a same-transaction CPU answer inside the
#     launcher's own commit. Per the row: treat a red AT THAT EXACT LINE as
#     F132, not a gate failure, IF it fires once and isolates green
#     (`npx vitest run src/lib/leagues/api/auction-api-db.test.ts`).
#   - F74 (latent): draft-realtime-db's readiness-gate race — a
#     realtime-delivery timeout in that file's subscribe phase.
#   Anything else: the gate is RED. Investigate, do not re-run to green.
#
# `set -euo pipefail` + no `&`/subshell swallowing: ANY partial failure
# aborts with that stage's non-zero exit (a partial pass must fail the whole
# command). Requires the local Supabase stack up (`supabase start`) and
# network for stage [3.5]'s free sync APIs; a down stack fails loudly at
# [1/9], never skips (§4.3; D59(5)).
#
# AFTER a gate run the local DB holds only migration seeds + the draft-scope
# restore from the LAST reset ([6/9]'s, via the M2 gate) — NOTHING ELSE.
# Re-create the local dev state per ACTIVE-BUILD before browser work: full
# `npm run restore:dev` (or RESTORE_SCOPE=draft) + the three Lists-v2
# fixtures (R215 saved-list, R219 round-board, R247 player_count drift).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "======================================================================"
echo "  M3 GATE (L.C6.1) — exit-criteria proof over the FULL migration chain"
echo "======================================================================"

echo ""
echo "!! THIS RESETS THE LOCAL DB — user-created local data (leagues, lists,"
echo "!! avatars) will be DESTROYED and cannot be restored; dev login and the"
echo "!! player pool are restored automatically (seed.sql + restore-dev.sh)."
echo "!! (L.C6.1 orchestrator ruling: the milestone gates are the sanctioned"
echo "!! exception to the no-ad-hoc-reset rule, and they announce themselves.)"

echo ""
echo "==> [1/9] Fresh local stack reset (pristine, fully-migrated chain 001-102)"
npx supabase db reset

echo ""
echo "==> [2/9] Full pgTAP suite — test:db (032-050 are the M3/AP/MP/MS files)"
echo "    (D144(5): this stage NEEDS the empty post-reset pool — before restore)"
npm run test:db

echo ""
echo "==> [3/9] M3 vitest gate — 36 enumerated suites (F84; see the config header)"
npx vitest run -c vitest.gate-m3.config.ts

echo ""
echo "==> [3.5] Draft-scope data restore (local-pinned; the sim/E2E/property pool)"
echo "    (D144(5): sim + E2E + the property-DB suite NEED the restored real pool)"
RESTORE_SCOPE=draft bash scripts/restore-dev.sh

echo ""
echo "==> [3.6] THE solvency property test, DB layer — on the restored pool (F84 #37)"
npx vitest run src/lib/leagues/api/auction-solvency-property-db.test.ts

echo ""
echo "==> [4/9] League Simulator — 25 concurrent bot AUCTION drafts (seed 42)"
npm run sim -- draft --type auction --leagues 25 --seed 42

echo ""
echo "==> [4.5] F56 bounded stack-health settle (diagnosed wait, never a sleep)"
npx tsx scripts/gate-settle.ts

echo ""
echo "==> [5/9] Playwright E2E — auction live/STORM/mock + the full M2 suite"
npm run test:e2e

echo ""
echo "==> [6/9] M2 gate — continuity (own fresh reset + pgTAP + sim + E2E + M1 + M0)"
npm run test:gate:m2

echo ""
echo "==> [7/9] M1 gate — continuity"
npm run test:gate:m1

echo ""
echo "==> [8/9] M0 gate — continuity"
npm run test:gate

echo ""
echo "======================================================================"
echo "  M3 GATE PASSED — every tasks-M3 §1 exit criterion green"
echo "======================================================================"
