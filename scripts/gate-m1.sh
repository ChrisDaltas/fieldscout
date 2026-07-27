#!/usr/bin/env bash
#
# gate-m1.sh — the M1 milestone gate (L.A1.16). Proves every tasks-M1 §1 exit
# criterion in ONE run and is the single entry point `npm run test:gate:m1`.
#
# Composition (tasks-M1 §6 L.A1.16: "vitest tag/dir + a test:db run"):
#   [1/4] Fresh `supabase db reset`  — the gate owns a pristine, fully-migrated
#         chain (001-063). Stack hygiene: the journey writes real rows on the
#         SHARED local stack; a reset-clean gate cannot pass on residue or a
#         drifted DB (orchestrator pointer; DoD "fresh db reset over the full
#         chain"). The vitest suites are additionally cleanup-first + afterAll.
#   [2/4] `npm run test:db`          — (d) full pgTAP suite (000-017; 005-017
#         are the M1 files). pgTAP runs each file in a rolled-back txn.
#   [3/4] vitest -c vitest.gate-m1.config.ts — (1a) Phase A journey + the
#         templates-only negative, (1b) snapshot force-transition probes,
#         (1c) template parity + TS<->DB equivalence, (3) settings round-trip.
#   [4/4] `npm run test:gate`        — (e) M0 gate still green (continuity).
#
# `set -euo pipefail` + no `&`/subshell swallowing means ANY partial failure
# aborts with that step's non-zero exit code (tasks-M1 §6: "a partial pass must
# fail the whole command"). Requires the local Supabase stack up (`supabase
# start`); a down stack fails loudly at step [1/4], never skips (§4.3; D59(5)).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "======================================================================"
echo "  M1 GATE (L.A1.16) — exit-criteria proof over migrations 001-063"
echo "======================================================================"

echo ""
echo "==> [1/4] Fresh local stack reset (pristine, fully-migrated chain)"
npx supabase db reset

echo ""
echo "==> [2/4] (d) Full pgTAP suite — test:db (005-017 are the M1 files)"
npm run test:db

echo ""
echo "==> [3/4] (1a/1b/1c/3) Vitest gate — journey + snapshot + parity + round-trip"
npx vitest run -c vitest.gate-m1.config.ts

echo ""
echo "==> [4/4] (e) M0 gate — continuity"
npm run test:gate

echo ""
echo "======================================================================"
echo "  M1 GATE PASSED — every tasks-M1 §1 exit criterion green"
echo "======================================================================"
