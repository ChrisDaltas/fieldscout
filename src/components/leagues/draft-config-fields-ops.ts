/**
 * Pure companion to `draft-config-fields.tsx` (the `-ops.ts` convention:
 * everything that can be pinned in vitest without rendering React lives
 * here). Framework-free — no JSX, no imports outside the settings contract.
 */
import { PICK_TIMER_SECONDS } from '@/lib/leagues/settings/league-settings'

/**
 * The §7.3.8 numeric bounds, in ONE place, mirrored from `draftConfigSchema`.
 *
 * A `min`/`max` on an `<input type="number">` plus `clampInt` is a THIRD
 * statement of a range the zod schema and migration 095's
 * `draft_settings_range_guard` already make, and there is no way to derive it
 * from a zod check that survives a zod upgrade. So it is a named constant
 * with a test beside it: `draft-config-fields.test.ts` asserts, for every
 * bound here, that `draftConfigSchema` accepts the edge and refuses one step
 * outside it — so a catalog change reddens instead of silently leaving the
 * control looser or tighter than the contract.
 */
export const DRAFT_FIELD_BOUNDS = {
  auction_budget: { min: 50, max: 1000 },
  auction_nomination_seconds: { min: 10, max: 120 },
  auction_bid_seconds: { min: 10, max: 60 },
  auction_anti_snipe_seconds: { min: 0, max: 15 },
} as const

/** §7.3.8 pick-clock labels — one label per OFFERED value, and the options
 *  are derived from `PICK_TIMER_SECONDS` itself (R506) so a surface cannot
 *  quietly drop a clock the contract offers. */
export const PICK_TIMER_LABELS: Record<number, string> = {
  0: 'No clock (untimed)',
  30: '30 seconds',
  45: '45 seconds',
  60: '1 minute',
  90: '90 seconds',
  120: '2 minutes',
  180: '3 minutes',
  300: '5 minutes',
  600: '10 minutes',
  3600: '1 hour',
  14400: '4 hours',
  28800: '8 hours',
  86400: '24 hours',
}

/** Every §7.3.8 clock, in catalog order, labelled. Derived — never a
 *  hand-kept second list (R506). */
export const pickTimerOptions = () =>
  PICK_TIMER_SECONDS.map((v) => ({ value: String(v), label: PICK_TIMER_LABELS[v] ?? `${v}s` }))

