import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { COVER_RING, CoverColorPicker } from '@/components/lists/list-form-dialog'
import { COVER_COLOR_TINTS, POS_TINTS, coverTint, listThumbnailLabel } from '@/components/lists/list-thumbnail'
import { coverBg } from '@/components/lists/v2/cover-tile'
import { COVER_SWATCHES, POSITION_GROUP_OPTIONS, coverBgClass, positionGroupValue } from '@/components/mobile/lists/lists-model'
import { coverClass } from '@/components/mobile/lists/lists-parts'
import { COVER_COLORS } from '@/lib/lists/cover-color'
import { POSITION_FILTERS } from '@/types/schemas/lists'

import tailwindConfig from '../../../tailwind.config'

/**
 * Cover colours on every surface (Chris, 2026-10-15; migration 188): the
 * chosen colour wins, else today's position colour — so a list with no colour
 * (every list made before the swatches) looks exactly as it did.
 *
 * The swatches are the design's six hexes (lr-lists §2.2); each surface maps
 * a key to a theme TOKEN, and this pins that every token resolves to the
 * design's hex.
 */

const DESIGN_HEX: Record<(typeof COVER_COLORS)[number], string> = {
  blue: '#0088FF',
  ink: '#1D1D1F',
  red: '#F75252',
  purple: '#9D70E9',
  indigo: '#5C7CE5',
  green: '#07B85A',
}

const colors = (tailwindConfig.theme?.extend as { colors: Record<string, unknown> }).colors

/** A palette entry's value: a hex string, or its `DEFAULT`. */
function valueOf(entry: unknown): string {
  if (typeof entry === 'string') return entry
  return String((entry as { DEFAULT?: string } | undefined)?.DEFAULT)
}

/** `bg-pos-qb` → `#F75252`, `ring-accent` → `#0088FF`, `bg-m-ink` → the
 *  light theme's `--m-ink` as hex. */
function hexOf(cls: string): string {
  const name = cls.replace(/^(bg|ring)-/, '')
  if (name === 'm-ink') {
    const css = readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
    const rgb = /:root \{[^}]*--m-ink: (\d+) (\d+) (\d+);/.exec(css)!
    return `#${rgb.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }
  if (name in colors) return valueOf(colors[name]).toUpperCase()
  const [group, ...rest] = name.split('-')
  return valueOf((colors[group] as Record<string, unknown>)[rest.join('-')]).toUpperCase()
}

describe('the six swatches resolve to the design’s hexes', () => {
  it('mobile swatches (fill and ring), in the design’s order', () => {
    expect(COVER_SWATCHES.map((s) => s.key)).toEqual([...COVER_COLORS])
    for (const swatch of COVER_SWATCHES) {
      expect(hexOf(swatch.bg), swatch.key).toBe(DESIGN_HEX[swatch.key])
      expect(hexOf(swatch.ring), swatch.key).toBe(DESIGN_HEX[swatch.key])
    }
  })

  it('desktop cover fills and the dialog’s rings', () => {
    for (const key of COVER_COLORS) {
      expect(hexOf(COVER_COLOR_TINTS[key].bg), key).toBe(DESIGN_HEX[key])
      expect(COVER_COLOR_TINTS[key].fg).toBe('text-white')
      expect(hexOf(COVER_RING[key]), key).toBe(DESIGN_HEX[key])
    }
  })
})

describe('mobile covers — chosen colour wins, else the position colour', () => {
  it('no colour: exactly today’s position rule', () => {
    expect(coverBgClass('QB')).toBe('bg-pos-qb')
    expect(coverBgClass('wr', null)).toBe('bg-pos-wr')
    expect(coverBgClass('TE', undefined)).toBe('bg-pos-te')
    expect(coverBgClass(null)).toBe('bg-accent')
  })

  it('a chosen colour overrides the position group', () => {
    expect(coverBgClass('QB', 'green')).toBe('bg-confirm')
    expect(coverBgClass(null, 'ink')).toBe('bg-m-ink')
    expect(coverBgClass('RB', 'purple')).toBe('bg-pos-wr')
  })

  it('an unknown value is ignored rather than painting nothing', () => {
    expect(coverBgClass('QB', '#123456')).toBe('bg-pos-qb')
  })

  it('an uploaded image still wins (ink behind it); a row from before 188 has no key', () => {
    expect(coverClass({ thumbnail_url: 'https://x/y.png', position_filter: 'QB', cover_color: 'red' })).toBe('bg-m-ink')
    expect(coverClass({ thumbnail_url: null, position_filter: 'QB', cover_color: 'blue' })).toBe('bg-accent')
    expect(coverClass({ thumbnail_url: null, position_filter: 'QB' })).toBe('bg-pos-qb')
  })
})

describe('desktop covers — chosen colour wins, else the position tint', () => {
  it('no colour: exactly POS_TINTS (all players = ink)', () => {
    for (const filter of [...POSITION_FILTERS, null]) {
      const label = listThumbnailLabel(filter)
      expect(coverTint(label, null)).toEqual(POS_TINTS[label])
      expect(coverBg({ id: 'l', title: 't', thumbnail_url: null, position_filter: filter })).toBe(POS_TINTS[label].bg)
    }
  })

  it('a chosen colour overrides it, on the tile and the gallery band alike', () => {
    expect(coverTint('QB', 'indigo')).toEqual(COVER_COLOR_TINTS.indigo)
    expect(coverTint('TM', 'blue').bg).toBe('bg-accent')
    expect(coverBg({ id: 'l', title: 't', thumbnail_url: null, position_filter: 'WR', cover_color: 'green' })).toBe(
      'bg-confirm',
    )
  })
})

describe('mobile position group choice', () => {
  it('offers "All" plus every stored position group, as desktop does', () => {
    expect(POSITION_GROUP_OPTIONS.map((o) => o.value)).toEqual(['ALL', 'QB', 'RB', 'WR', 'FLEX', 'TE', 'DEF', 'K'])
    expect(new Set(POSITION_GROUP_OPTIONS.map((o) => o.value).filter((v) => v !== 'ALL'))).toEqual(
      new Set(POSITION_FILTERS),
    )
    expect(POSITION_GROUP_OPTIONS.find((o) => o.value === 'DEF')?.label).toBe('D/ST')
  })

  it('reads a stored filter back as its choice; none (or junk) is "All"', () => {
    expect(positionGroupValue('QB')).toBe('QB')
    expect(positionGroupValue('def')).toBe('DEF')
    expect(positionGroupValue(null)).toBe('ALL')
    expect(positionGroupValue('IDP')).toBe('ALL')
  })
})

describe('desktop list dialog — the cover colour picker', () => {
  const render = (value: (typeof COVER_COLORS)[number] | null) =>
    renderToStaticMarkup(createElement(CoverColorPicker, { value, onChange: () => {} }))

  it('six swatches on the cover fills; none pressed with no colour chosen', () => {
    const out = render(null)
    expect(out.match(/<button/g)).toHaveLength(6)
    for (const key of COVER_COLORS) expect(out).toContain(COVER_COLOR_TINTS[key].bg)
    expect(out).not.toContain('aria-pressed="true"')
    expect(out).toContain('Follows the position group until you pick one.')
  })

  it('the chosen colour is pressed and ringed in its own colour — a ring, never a shadow', () => {
    const out = render('indigo')
    expect(out).toMatch(/aria-pressed="true" aria-label="Indigo"[^>]*class="[^"]*ring-offset-2[^"]*ring-pos-rb/)
    expect(out).not.toMatch(/\bshadow-/)
    expect(out).toContain('Click it again to follow the position group.')
  })

  it('a team list (no position group field) says "the default colour" instead', () => {
    const team = (value: (typeof COVER_COLORS)[number] | null) =>
      renderToStaticMarkup(createElement(CoverColorPicker, { value, onChange: () => {}, isTeam: true }))
    expect(team(null)).toContain('Uses the default colour until you pick one.')
    expect(team(null)).not.toContain('position group')
    expect(team('ink')).toContain('Click it again to go back to the default colour.')
  })
})
