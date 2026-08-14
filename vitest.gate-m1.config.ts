import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M1 gate suite (L.A1.16) — the vitest half of `npm run test:gate:m1`. Runs
 * exactly the files that prove the §1 exit criteria, one file per criterion
 * (see PROGRESS §8 exit-criterion → proof map). It does NOT rewrite the
 * existing proofs — it COMPOSES them (tasks-M1 §6 L.A1.16 "the gate RUNS them").
 *
 *   (1a) Phase A journey + templates-only negative — the NEW L.A1.16 work.
 *   (1b) snapshot present from draft start — the L.A1.11 force-transition probes.
 *   (1c-parity) template parity, 6 × 5 player-weeks to the cent (L.A1.10).
 *   (1c-equiv)  TS↔DB template-rules equivalence (L.A1.9(5)).
 *   (3) settings round-trip for every §7.3 field, real PATCH/GET path (L.A1.13).
 *
 * The M0 gate (`test:gate`) and the full pgTAP suite (`test:db`) are the
 * OTHER two halves of `test:gate:m1`; the runner (`scripts/gate-m1.sh`)
 * sequences all three under `set -euo pipefail` so any partial failure fails
 * the whole command (tasks-M1 §6: "a test:db run" + the M0 continuity gate).
 *
 * FLAT config, deliberately (L.B7.1): the base config now carries the
 * unit/stack `projects` split, and a root `include` merged onto a projects
 * config is silently ignored — this file therefore builds its own flat
 * config from the base's exported shared pieces. All five files here are
 * stack-backed, so the gate runs them SEQUENTIALLY (fileParallelism: false)
 * — the same F52 suite-isolation discipline the full run uses.
 *
 * Kept OUT of `src/lib/leagues/gate/` on purpose: `test:gate` filters by the
 * substring `src/lib/leagues/gate`, so the M1 journey lives under
 * `src/lib/leagues/m1-gate/` (no substring collision) and never pollutes the
 * M0 continuity gate.
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      'src/lib/leagues/m1-gate/**/*.test.ts',
      'src/lib/leagues/lifecycle/lifecycle-db.test.ts',
      'src/lib/leagues/scoring/template-parity.test.ts',
      'src/lib/leagues/scoring/templates-db.test.ts',
      'src/lib/leagues/api/settings-round-trip-db.test.ts',
    ],
  },
})
