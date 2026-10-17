import { BAND_RAMP } from '@/components/lists/bucket-colors'

/**
 * FieldScout Mobile — tier colours. ONE palette everywhere: desktop's (Chris,
 * 2026-10-15, mobile gap list #10). Tier N takes the `tier-N` token (1 pink,
 * 2 red, 3 orange, 4 gold, 5 green, 6 teal, 7 blue), cycling past 7 exactly
 * as desktop's list bands do — the recipe is desktop's own `BAND_RAMP`
 * (`lists/bucket-colors.ts`), reused rather than copied, so a change there
 * moves both layouts. Shared by mobile Lists (list view + editor) and the
 * Rankings hub.
 *
 * The ramp is fixed colours drawn for FILLS: desktop sets each tier as a
 * chip/band with its own white-or-ink text (tiers 3–4 ink). As text on the
 * white page gold would be ~1.9:1 and orange ~2.8:1, so the mobile label is
 * desktop's chip — identical in light and dark mode, since the fill carries
 * its own text colour.
 *
 * And AA-readable: Chris (2026-10-15) took darker shades of the same hues
 * for tiers 1, 2, 5 and 6, so the chip's 11px white text passes 4.5:1 on
 * every fill (3–4 ink, 7 unchanged). That was answered once, in the `tier`
 * tokens of `tailwind.config.ts`, never with a mobile-only colour —
 * `lists/bucket-colors.test.ts` measures every pair.
 */

/** Shape of the "Tier N" chip on mobile (the colour comes from the ramp). */
const TIER_CHIP_SHAPE = 'inline-flex h-5 flex-none items-center rounded-[6px] px-2 text-[11px] font-bold leading-none'

/** Fill-only steps of the same ramp, spelled out in full for Tailwind's JIT. */
const TIER_FILL = ['bg-tier-1', 'bg-tier-2', 'bg-tier-3', 'bg-tier-4', 'bg-tier-5', 'bg-tier-6', 'bg-tier-7'] as const

/**
 * The "Tier N" label chip — desktop's fill + text recipe. `index` is 0-based
 * (Tier 1 = 0); a negative index (a list's "Ungrouped" header) is plain grey
 * text, since it is not a tier.
 */
export function tierChipClass(index: number): string {
  if (index < 0) return 'text-[12px] font-bold text-m-t3'
  return `${TIER_CHIP_SHAPE} ${BAND_RAMP[index % BAND_RAMP.length]}`
}

/** The tier's colour as a fill only (the list editor's tier-line hairline). */
export function tierFillClass(index: number): string {
  if (index < 0) return 'bg-m-t3'
  return TIER_FILL[index % TIER_FILL.length]!
}
