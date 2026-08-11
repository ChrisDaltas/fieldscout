import { describe, expect, it } from 'vitest'

import {
  BAND_RAMP,
  TIER_RAMP,
  UNKNOWN_BUCKET_STYLE,
  bucketBadgeClass,
  bucketBandClass,
} from './bucket-colors'
import { BUCKET_KEYS, ROUND_VALUES, TIER_VALUES } from '@/types/schemas/lists'

/**
 * LV.1.5 — **no bucket key renders uncoloured.**
 *
 * `tier-badge.tsx`'s `TIER_BG` and `TIER_BAND_BG` were `Record<ListTier, string>`: total over the
 * six tier letters and *undefined* for anything else. `cn(undefined)` is silent,
 * so `TIER_BAND_BG['r1']` produced a band with no fill and nothing failed —
 * on the flag-OFF legacy detail view and on the **server-rendered public share
 * view** (plan **D7**), which is SEO-critical. Migration 081 made `r1` a value
 * the column can actually hold, so this stopped being hypothetical.
 *
 * The fix is that they are functions total over `string` with an explicit
 * fallback. The pins below are about the property, not the palette: every key
 * the vocabulary defines gets a real class, everything else gets the *named*
 * fallback, and neither ever returns `undefined`.
 */

/** Every class these helpers emit must actually paint something. */
function paints(value: string): boolean {
  return typeof value === 'string' && /^bg-\S+/.test(value)
}

describe('bucket colouring is total', () => {
  it('gives every one of the 40 vocabulary keys a real class', () => {
    for (const key of BUCKET_KEYS) {
      expect(paints(bucketBandClass(key)), `band ${key}`).toBe(true)
      expect(paints(bucketBadgeClass(key)), `badge ${key}`).toBe(true)
      // The specific regression: not the fallback, an actual ramp step.
      expect(BAND_RAMP).toContain(bucketBandClass(key))
    }
  })

  it('gives an unknown key the named fallback, never undefined', () => {
    // Unreachable through the CHECK, reachable through a bug, a stale row, or a
    // future widening that forgets this file.
    for (const key of ['', 'r31', 'c9', 'Z', '__proto__', 'untiered', 'ungrouped']) {
      expect(bucketBandClass(key)).toBe(UNKNOWN_BUCKET_STYLE)
      expect(bucketBadgeClass(key)).toBe(UNKNOWN_BUCKET_STYLE)
    }
    expect(paints(UNKNOWN_BUCKET_STYLE)).toBe(true)
  })

  it('leaves the S–F colours exactly where they were', () => {
    // The widening must move no existing pixel: S–F keep their historical ramp
    // step, in the same order, on both surfaces that render them.
    TIER_VALUES.forEach((tier, index) => {
      expect(bucketBandClass(tier)).toBe(TIER_RAMP[index])
      expect(bucketBadgeClass(tier)).toBe(TIER_RAMP[index])
    })
  })

  it('cycles the ramp across 30 rounds rather than running out', () => {
    // Plan D4: "the color ramp has 6–7 hues against up to 30 rounds, so round
    // mode cycles colors rather than assigning a unique one per bucket."
    expect(bucketBandClass('r1')).toBe(BAND_RAMP[0])
    expect(bucketBandClass('r7')).toBe(BAND_RAMP[6])
    expect(bucketBandClass('r8')).toBe(BAND_RAMP[0])
    expect(bucketBandClass('r30')).toBe(BAND_RAMP[(30 - 1) % BAND_RAMP.length])
    expect(new Set(ROUND_VALUES.map(bucketBandClass)).size).toBe(BAND_RAMP.length)
  })

  it('keeps one ramp: BAND_RAMP extends TIER_RAMP rather than restating it', () => {
    // `big-board/**` indexes TIER_RAMP positionally and is off limits to this
    // build, so the seventh step lives only on BAND_RAMP.
    expect(TIER_RAMP).toHaveLength(6)
    expect(BAND_RAMP).toHaveLength(7)
    expect(BAND_RAMP.slice(0, 6)).toEqual([...TIER_RAMP])
  })
})
