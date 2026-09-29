#!/usr/bin/env bash
#
# gate-m5.sh — the M5 milestone gate (L.D3.10). Proves every tasks-M5 §1 exit
# criterion in ONE run and is the single entry point `npm run test:gate:m5`.
#
# Composition (tasks-M5 §6 L.D3.10: "fresh db reset → full pgTAP → M5 vitest
# (resolver properties + parity) → sim season with transacting personas
# across the settings matrix (FAAB / rolling / reverse; each review mode) →
# the M5 E2E → test:gate:m4"; the L.D6.3 precedent — the gate COMPOSES the
# existing proofs, never rewrites them):
#   [1/9]  Fresh `supabase db reset` — the full chain (001-159 at L.D3.10 — 159 is F409's FAAB-budget range,
#          built here because no M5 task replaced the two setup verbs).
#   [2/9]  `npm run test:db` — the FULL pgTAP suite (093-107 are M5's band:
#          claims, FAAB carry, the schedule, the processor + tick, the week
#          ceiling, commish FAAB, trades core / execution / vote / force,
#          one-slot-per-week, the played lock, stored points, the budget
#          range). Runs on the
#          EMPTY post-reset pool (D144(5)), so before [3.5].
#   [3/9]  vitest -c vitest.gate-m5.config.ts — 37 files enumerated by name
#          (F84): exit criterion 2 (the L.D2.8 resolver's worked examples +
#          property tests, the SQL ⇔ TS parity) and every M5 stack / service /
#          route / hook / UI suite. Serialized (F52).
#   [3.5]  Draft-scope data restore (RESTORE_SCOPE=draft, local-pinned) — the
#          sim and the E2E draft the REAL local pool.
#   [3.6]  `npm run sim:census` PRE-FLIGHT (F199) — now eleven cells, the
#          eleventh counting any `sim-world:` status mask a run left (F374).
#   [4/9]  THE TRANSACTING SEASON across the settings matrix (exit criteria 1
#          and 3; F457): `sim season --transact --leagues 24 --weeks 2
#          --seed 42`. Every league runs the whole transacting script (claims →
#          the waiver run, the Ghost, a trade under EACH review mode —
#          commissioner / none / league_vote — plus a reversal, a commissioner
#          FAAB edit, add/drops) under ONE claim type by its plan number mod 3
#          (faab / rolling_priority / reverse_standings — D423), over the D299
#          matrix the plan draws (8-16 teams, h2h / total_points, the illegal-
#          lineups axis, eight templates + a fork). Every TRANSACTION PREMISE
#          line is a run problem (red), and [4.1] re-reads the report by name.
#   [4.1]  `gate-m5-evidence.ts transact` — the matrix claims, by name.
#   [4.2]..[4.5]  THE FOUR BREAK PROBES (F457 / R1242): `--probe exclusivity
#          | faab-ledger | pool-mirror | claim-privacy` at `--leagues 3` (one
#          league per claim type). Each run MUST exit 1, and
#          `gate-m5-evidence.ts probe` then asserts it went red BY THE NAMED
#          INVARIANT and by nothing else — a probe that stopped landing, or a
#          red for an unrelated reason, fails the gate.
#   [5/9]  `npm run sim:census` POST-FLIGHT.
#   [6/9]  The F56 bounded stack-health settle before Playwright.
#   [7/9]  The M5 E2E — `e2e/transactions.spec.ts` (L.D3.9: waiver morning,
#          a trade per review mode, a deferred trade, F296's lock refusal).
#   [7.5]  The same settle after Playwright (F298).
#   [8/9]  `npm run test:gate:m4` — continuity (exit criterion 4): its own
#          fresh reset + pgTAP + the M4 vitest gate + NINE 100-league synthetic
#          seasons + evidence + the full E2E suite (inseason-week with F471's
#          fixed D/ST line among it) + `test:gate:m3` → m2 → m1 → M0.
#   [9/9]  Banner.
#
# WHAT L.D3.10 CHANGED UNDER THE COMPOSED STAGES (D423) — each a harness fix,
# none a threshold, a skipped stage or a changed claim:
#   - F375: the season sim's local transport is a `node:http` keep-alive
#     agent (`scripts/sim-keepalive-fetch.ts`). Node 24.14's global fetch
#     (undici 7.24.4) opens a fresh socket per request once Kong has closed a
#     connection (Kong's keep-alive request limit is 100), so the 100-league
#     stages exhausted the ephemeral ports; measured 11,261 sockets for one
#     happy_path run before, 974 after.
#   - F374: a season run masks the pool's real §7.3.6 blocking designations
#     (`status` → `sim-world:<original>`) for its duration; every sweep
#     restores them and the census counts any left. The synthetic season's
#     designations come from the scenario library, never from the day's
#     injury report.
#   - R1266 (the fix round): masking alone left the §7.3.6 legality arm with
#     nothing to police, so a season run also PLANTS up to two synthetic `Out`s
#     per OFF league, on men the harness would start for a managed seat, only
#     where every OFF seat holding them keeps a healthy man at the position
#     (F374 cannot come back through a plant); the sweep restores them, the
#     census counts them, and an OFF league that passed over nobody is a
#     `LEGALITY PREMISE` problem — here AND in gate-m4-evidence / [4.1].
#   - F480 (a PRODUCT fix, found by this gate's first run): the trade
#     center's `?with=&player=` door decided once, in the initial state, and
#     was lost whenever the league read beat the session (`useAuth` user still
#     null) — `transactions.spec.ts:155` red inside gate-m3's browser run,
#     reproduced by construction (the session held 4 s) and fixed: the door
#     opens the first time the viewer's team is known.
#   - The sim sweep's team lookup is paged (100 leagues hold ~1,200 teams, past
#     PostgREST's 1000-row cap — the F406 detach step left the rest attached
#     and the league delete failed).
#
# FLAKE POLICY: none of its own. The composed `test:gate:m4` carries its own
# single entry (F132) — see gate-m4.sh. An unnamed red FAILS this gate.
#
# `set -euo pipefail`, no backgrounding, NO RETRIES: any stage's non-zero exit
# aborts the gate (the probe stages capture their EXPECTED exit 1 explicitly
# and fail on anything else). LOCAL ONLY — sim.ts / sim-census.ts refuse any
# non-127.0.0.1 URL, and Playwright pins the dev server to the local stack.
#
# RUNNING IT: from the repo root, local Supabase up (`supabase start`). From a
# git worktree it ran as-is on 2026-09-28 (`db reset` / `test db` answered from
# the worktree cwd); if the CLI ever hangs there, run the gate from the main
# checkout of the same commit. If `docker pull` wedges on the credential
# helper, point `DOCKER_CONFIG` at a directory holding a bare `{}`.
#
# EXPECT HOURS: [8/9] alone is the whole M4 → M0 chain. Every stage prints its
# own elapsed seconds and the banner prints the total. AFTER a run the local DB
# holds only migration seeds + the LAST reset's draft-scope restore — re-create
# dev state with `RESTORE_SCOPE=draft npm run restore:dev` (or the full
# restore). The `.gate-m5/` report directory is gitignored.
set -euo pipefail

cd "$(dirname "$0")/.."

GATE_T0=$SECONDS
STAGE_T0=$SECONDS
stage() {
  STAGE_T0=$SECONDS
  echo ""
  echo "==> $1"
}
took() {
  echo "    [stage: $((SECONDS - STAGE_T0))s | elapsed: $((SECONDS - GATE_T0))s]"
}

echo "======================================================================"
echo "  M5 GATE (L.D3.10) — transactions: exit-criteria proof, full chain"
echo "======================================================================"
echo ""
echo "!! THIS RESETS THE LOCAL DB (several times — the composed M4 → M1 gates"
echo "!! reset too). User-created local data is DESTROYED; dev login and the"
echo "!! player pool are restored automatically (seed.sql + restore-dev.sh)."

REPORT_DIR=.gate-m5
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

stage "[1/9] Fresh local stack reset (pristine, fully-migrated chain)"
npx supabase db reset
took

stage "[2/9] Full pgTAP suite — test:db (093-107 are the M5 files)"
npm run test:db
took

stage "[3/9] M5 vitest gate — 37 enumerated suites (resolver properties + parity first)"
npx vitest run -c vitest.gate-m5.config.ts
took

stage "[3.5] Draft-scope data restore (local-pinned; the sim/E2E pool)"
RESTORE_SCOPE=draft bash scripts/restore-dev.sh
took

stage "[3.6] Sim census PRE-FLIGHT (F199)"
npm run sim:census
took

stage "[4/9] Transacting season — 24 leagues x 2 weeks, seed 42, claim types x review modes"
npm run sim -- season --leagues 24 --weeks 2 --seed 42 --transact --report "$REPORT_DIR/transact.json"
took

stage "[4.1] Evidence — the matrix, by name"
npx tsx scripts/gate-m5-evidence.ts transact "$REPORT_DIR/transact.json"
took

probe_stage() {
  local label="$1" probe="$2"
  stage "$label Break probe --probe $probe (must exit 1, red by the named invariant alone)"
  set +e
  npm run sim -- season --leagues 3 --weeks 2 --seed 42 --transact --probe "$probe" --report "$REPORT_DIR/probe-$probe.json"
  local code=$?
  set -e
  if [ "$code" -ne 1 ]; then
    echo "    PROBE $probe exited $code — expected 1 (a probe run that is not red, or that died, proves nothing)"
    exit 1
  fi
  npx tsx scripts/gate-m5-evidence.ts probe "$probe" "$REPORT_DIR/probe-$probe.json"
  took
}
probe_stage "[4.2]" exclusivity
probe_stage "[4.3]" faab-ledger
probe_stage "[4.4]" pool-mirror
probe_stage "[4.5]" claim-privacy

stage "[5/9] Sim census POST-FLIGHT (the runs left nothing behind)"
npm run sim:census
took

stage "[6/9] F56 bounded stack-health settle (diagnosed wait, never a sleep)"
npx tsx scripts/gate-settle.ts
took

stage "[7/9] The M5 E2E — e2e/transactions.spec.ts in real browsers"
npx playwright test e2e/transactions.spec.ts
took

stage "[7.5] The SAME settle AFTER Playwright (F298)"
npx tsx scripts/gate-settle.ts
took

stage "[8/9] M4 gate — continuity (own reset + pgTAP + 100-league seasons + E2E + M3/M2/M1/M0)"
npm run test:gate:m4
took

echo ""
echo "======================================================================"
echo "  M5 GATE PASSED — tasks-M5 §1 exit criteria 1-4 green"
echo "  TOTAL: $((SECONDS - GATE_T0))s"
echo "======================================================================"
