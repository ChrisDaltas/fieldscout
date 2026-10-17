import { describe, expect, it } from 'vitest'

import { BAND_RAMP } from '@/components/lists/bucket-colors'
import { tierChipClassFor } from '@/components/mobile/rankings/rankings-ops'

import { tierChipClass, tierFillClass } from './tier-colors'

/**
 * Gap list #10 (Chris, 2026-10-15): ONE tier palette everywhere — desktop's.
 * The same tier number is the same colour on desktop lists, mobile Lists and
 * the mobile Rankings hub.
 */
describe('mobile tier colours = desktop palette', () => {
  it('Tier N takes the tier-N token, Tier 1 pink (not the old phone blue)', () => {
    for (let n = 1; n <= 7; n += 1) {
      expect(tierChipClass(n - 1)).toContain(`bg-tier-${n}`)
      expect(tierFillClass(n - 1)).toBe(`bg-tier-${n}`)
    }
    expect(tierChipClass(0)).not.toMatch(/m-pos-rb/)
  })

  it('uses desktop’s own fill + text recipe (tiers 3–4 ink, the rest white)', () => {
    BAND_RAMP.forEach((recipe, i) => {
      expect(tierChipClass(i).endsWith(recipe)).toBe(true)
    })
    expect(tierChipClass(2)).toContain('text-ink')
    expect(tierChipClass(3)).toContain('text-ink')
    expect(tierChipClass(4)).toContain('text-white')
  })

  it('cycles past 7 the way desktop’s list bands do', () => {
    expect(tierFillClass(7)).toBe('bg-tier-1')
    expect(tierChipClass(7)).toContain('bg-tier-1')
  })

  it('the Ungrouped header is not a tier: plain grey text, no fill', () => {
    expect(tierChipClass(-1)).toBe('text-[12px] font-bold text-m-t3')
    expect(tierFillClass(-1)).toBe('bg-m-t3')
  })

  it('Rankings (1-based tiers) gives the same colour for the same tier number as Lists', () => {
    for (let n = 1; n <= 8; n += 1) expect(tierChipClassFor(n)).toBe(tierChipClass(n - 1))
  })
})
