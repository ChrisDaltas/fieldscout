import { describe, expect, it } from 'vitest'

import {
  BAND_RAMP,
  TIER_RAMP,
  UNKNOWN_BUCKET_STYLE,
  bucketBadgeClass,
  bucketBandClass,
} from './bucket-colors'
import { BUCKET_KEYS, ROUND_VALUES, TIER_VALUES } from '@/types/schemas/lists'

import tailwindConfig from '../../../tailwind.config'

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

/**
 * Tier chip contrast (Chris, 2026-10-15): every step's text on its own fill
 * passes WCAG AA for small text — 4.5:1. The chips are 11–13px bold (mobile
 * "Tier N" chip, desktop TierBadge, list bands, Big Board bands), well under
 * AA's "large text" size, so the 3:1 large-text allowance never applies.
 *
 * Measured from the real sources: the recipe's `bg-tier-N` / `text-*` classes
 * resolved through `tailwind.config.ts`, so a palette edit that drops a chip
 * under AA fails here rather than on someone's screen. Before this ruling,
 * white on tiers 1, 2, 5 and 6 measured ~4.0, 3.8, 3.3 and 3.4:1.
 */
describe('tier chip text passes WCAG AA (4.5:1) on every fill', () => {
  const colors = (tailwindConfig.theme?.extend as { colors: Record<string, unknown> }).colors

  /** A palette entry's hex: a plain string, or its `DEFAULT`. */
  function hexOfEntry(entry: unknown): string {
    const value = typeof entry === 'string' ? entry : (entry as { DEFAULT?: unknown } | undefined)?.DEFAULT
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error(`not a 6-digit hex: ${String(value)}`)
    }
    return value
  }

  /** `tier-3` → the tier group's `3`; `ink` → ink's DEFAULT; `white` → #ffffff. */
  function hexOfToken(token: string): string {
    if (token === 'white') return '#ffffff'
    if (token in colors) return hexOfEntry(colors[token])
    const [group, ...rest] = token.split('-')
    return hexOfEntry((colors[group] as Record<string, unknown> | undefined)?.[rest.join('-')])
  }

  /** WCAG 2.x relative luminance of a `#rrggbb`. */
  function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  /** A recipe's fill and text tokens (`bg-tier-1 text-white` → tier-1, white). */
  function pairOf(recipe: string): { fill: string; text: string } {
    const fill = /(?:^|\s)bg-(\S+)/.exec(recipe)?.[1]
    const text = /(?:^|\s)text-(\S+)/.exec(recipe)?.[1]
    if (!fill || !text) throw new Error(`recipe without a fill and a text colour: ${recipe}`)
    return { fill, text }
  }

  it('sanity: the measure matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // #767676 on white is the classic "just passes AA" grey (4.54:1).
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })

  it.each(BAND_RAMP.map((recipe, i) => [i + 1, recipe] as const))('tier %i (%s)', (_tier, recipe) => {
    const { fill, text } = pairOf(recipe)
    const ratio = contrast(hexOfToken(fill), hexOfToken(text))
    expect(ratio, `${text} on ${fill} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('the unknown-bucket fallback passes too', () => {
    const { fill, text } = pairOf(UNKNOWN_BUCKET_STYLE)
    expect(contrast(hexOfToken(fill), hexOfToken(text))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the ruled text colours: tiers 3–4 ink, the rest white', () => {
    expect(BAND_RAMP.map((recipe) => pairOf(recipe).text)).toEqual([
      'white',
      'white',
      'ink',
      'ink',
      'white',
      'white',
      'white',
    ])
  })
})
