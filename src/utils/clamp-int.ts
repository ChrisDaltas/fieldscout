/**
 * The number-input clamp the league forms have always used.
 *
 * Lifted out of `components/leagues/settings-form-controls.tsx` (unchanged,
 * and still re-exported from there so every existing import site reads the
 * same) so that PURE ops modules can share it: a `.ts` module cannot import a
 * `.tsx` one under the unit lane's transform, and the alternative — a second
 * copy of four lines — is exactly the near-duplicate the house rules forbid.
 *
 * First shared by `components/draft/commish-auction-ops.ts` (R435, M3 batch
 * 14: the draft room's auction Clock form printed §7.3.8's ranges and
 * enforced none of them).
 */

/** Parse a number input, clamp to [min,max], falling back to `fallback` for
 *  empty/NaN so the control never emits an out-of-range or NaN value. */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
