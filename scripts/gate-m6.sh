#!/usr/bin/env bash
#
# gate-m6.sh — the M6 milestone gate (L.E1.37). Proves every tasks-M6 §1 /
# §9 exit criterion in ONE run and is the single entry point
# `npm run test:gate:m6`.
#
# Composition (tasks-M6 §6 L.E1.37: "fresh db reset → full pgTAP (incl.
# L.E1.31's census) → the M6 vitest set (ingest classification, records,
# replay, copy census) → the season sim with the correction scenarios and one
# commissioner override per run → the M6 E2E → test:gate:m5"; the gate
# COMPOSES the existing proofs, never rewrites them — the L.D6.3 precedent):
#   [1/8]  Fresh `supabase db reset` — the full chain (001-176 at L.E1.37).
#   [2/8]  `npm run test:db` — the FULL pgTAP suite. M6's band is 115-124:
#          the correction events (115), the draft / membership receipts
#          (116 / 117), L.E1.31's backstop census + matrix + guards (118),
#          the draft doors (119), the league correction records (120), the
#          retire door (121), L.D3.16's trade powers (122), F555's receipt
#          insert policy (123), L.E1.42's retire removal (124).
#          On the EMPTY post-reset pool (D144(5)).
#   [3/8]  vitest -c vitest.gate-m6.config.ts — 75 files enumerated by name
#          (F84); the membership rule is in the config. Serialized (F52).
#   [3.5]  Draft-scope data restore (RESTORE_SCOPE=draft, local-pinned).
#   [3.6]  `npm run sim:census` PRE-FLIGHT (F199).
#   [4/8]  THE CORRECTION SEASONS: `sim season --scenario correction_in_window`
#          and `--scenario correction_post_window`, 24 leagues × 2 weeks,
#          seed 42. Every season run injects ONE lawful commissioner override
#          on a final cell (D345 / L.E1.14 — F373's licence unchanged; TD6's
#          correction records are not overrides).
#   [4.2]  `gate-m6-evidence.ts` — the arms by name (L.E2.6's
#          correction_recorded_in_window / correction_research_only_after_lock
#          among them) + the override per run.
#   [5/8]  `npm run sim:census` POST-FLIGHT.
#   [6/8]  The F56 settle → the M6 E2E (`e2e/commish-console.spec.ts`,
#          L.E1.36) → the same settle after (F298).
#   [7/8]  `npm run test:gate:m5` — continuity (§9 criterion 4): its own
#          fresh reset + pgTAP + M5 vitest + transacting season + probes +
#          E2E + test:gate:m4 → m3 → m2 → m1 → M0.
#   [8/8]  Banner.
#
# §9 CRITERION 3 — READ THIS. Chris 2026-10-02 (D468): "yeah lets not hold
# for it." The criterion is met on SYNTHETIC corrections (test fixtures,
# marked synthetic) — the replay suite in [3/8] and the seasons in [4/8].
# The REAL recorded-correction leg is NON-BLOCKING and still OPEN under F540
# (L.E2.5 unticked): no real 2026 correction has been captured, and the
# replay suite says so in its own output. This gate does not claim it.
#
# Q83 dropped: no lineup-report flow and no illegal-lineup criterion here.
#
# FLAKE POLICY: none of its own (the composed gates carry theirs). `set -euo
# pipefail`, no backgrounding, NO RETRIES. LOCAL ONLY — sim / census refuse
# any non-127.0.0.1 URL; Playwright pins the dev server to the local stack.
#
# RUNNING IT: from the repo root (or a worktree — the CLI answered from a
# worktree cwd on 2026-10-02), local Supabase up. If `docker pull` wedges on
# the credential helper, point `DOCKER_CONFIG` at a directory holding `{}`.
# EXPECT HOURS ([7/8] is the whole M5 → M0 chain). AFTER a run, re-create
# dev state with `RESTORE_SCOPE=draft npm run restore:dev`. `.gate-m6/` is
# gitignored.
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
echo "  M6 GATE (L.E1.37) — commissioner console + audit, stat corrections"
echo "======================================================================"
echo ""
echo "!! THIS RESETS THE LOCAL DB (several times — the composed M5 → M1 gates"
echo "!! reset too). User-created local data is DESTROYED."

REPORT_DIR=.gate-m6
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

stage "[1/8] Fresh local stack reset (pristine, fully-migrated chain)"
npx supabase db reset
took

stage "[2/8] Full pgTAP suite — test:db (115-124 are the M6 files, 118 = L.E1.31's census)"
npm run test:db
took

stage "[3/8] M6 vitest gate — 75 enumerated suites (ingest classification, records, replay, copy census)"
npx vitest run -c vitest.gate-m6.config.ts
took

stage "[3.5] Draft-scope data restore (local-pinned; the sim/E2E pool)"
RESTORE_SCOPE=draft bash scripts/restore-dev.sh
took

stage "[3.6] Sim census PRE-FLIGHT (F199)"
npm run sim:census
took

stage "[4/8] Correction season — correction_in_window, 24 leagues x 2 weeks, seed 42"
npm run sim -- season --leagues 24 --weeks 2 --seed 42 --scenario correction_in_window --report "$REPORT_DIR/correction_in_window.json"
took

stage "[4.1] Correction season — correction_post_window, 24 leagues x 2 weeks, seed 42"
npm run sim -- season --leagues 24 --weeks 2 --seed 42 --scenario correction_post_window --report "$REPORT_DIR/correction_post_window.json"
took

stage "[4.2] Evidence — the correction arms by name + one commissioner override per run"
npx tsx scripts/gate-m6-evidence.ts "$REPORT_DIR/"
took

stage "[5/8] Sim census POST-FLIGHT"
npm run sim:census
took

stage "[6/8] F56 settle → the M6 E2E (e2e/commish-console.spec.ts) → settle (F298)"
npx tsx scripts/gate-settle.ts
npx playwright test e2e/commish-console.spec.ts
npx tsx scripts/gate-settle.ts
took

stage "[7/8] M5 gate — continuity (own reset + pgTAP + M5 vitest + season + probes + E2E + M4 → M0)"
npm run test:gate:m5
took

echo ""
echo "======================================================================"
echo "  M6 GATE PASSED — tasks-M6 §9 criteria 1, 2, 4 green; criterion 3 green"
echo "  on SYNTHETIC corrections. The real recorded-correction leg is NOT"
echo "  proven here: non-blocking by Chris's 2026-10-02 ruling (D468), open"
echo "  under F540, L.E2.5 unticked."
echo "  TOTAL: $((SECONDS - GATE_T0))s"
echo "======================================================================"
