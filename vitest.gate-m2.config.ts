import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M2 gate suite (L.B7.1) — the vitest slice of `npm run test:gate:m2`
 * (tasks-M2 §6 L.B7.1 item 1: "draft-core/tick/mock DB suites + the D90
 * parity fixture"). It COMPOSES the existing proofs — the L.A1.16
 * precedent; nothing is rewritten for composition's sake:
 *
 *   - draft-core-db      — the 066 serialized core over the wire (E1 race,
 *                          E2 replay, lock discipline).
 *   - draft-tick-db      — 068's authoritative clock: autopick, the
 *                          every-seat-times-out completion, SKIP-LOCKED
 *                          tick, K/D-ST deferral (E30).
 *   - draft-commish-api-db — the §8.7 commissioner control block + the
 *                          MOCK lifecycle over the routes (§8.8: launch /
 *                          replay / pause-resume / DELETE launcher-only).
 *   - draft-order-parity — the D90 snake/linear order parity fixture.
 *
 * The OTHER slices of `test:gate:m2` (scripts/gate-m2.sh) prove the rest:
 * fresh `db reset` → full pgTAP (019–026 + 031 are the M2 files) → THIS
 * config → the L.B6.1 25-league sim run → `test:e2e` → `test:gate:m1` →
 * `test:gate` (M0/M1 continuity).
 *
 * FLAT config (no projects — see vitest.gate-m1.config.ts's note) with
 * fileParallelism: false: all four files are stack-backed, so the gate runs
 * them sequentially — the F52 suite-isolation discipline.
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      'src/lib/leagues/api/draft-core-db.test.ts',
      'src/lib/leagues/api/draft-tick-db.test.ts',
      'src/lib/leagues/api/draft-commish-api-db.test.ts',
      'src/components/draft/draft-order-parity-db.test.ts',
    ],
  },
})
