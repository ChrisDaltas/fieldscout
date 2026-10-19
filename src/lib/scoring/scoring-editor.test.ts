/**
 * The personal scoring builder's model — one for desktop and the phone (gap
 * list §4 item 101).
 */
import { describe, expect, it } from 'vitest'

import { PPR_SCORING, STANDARD_SCORING } from './default'
import {
  CUSTOM_DEFAULT_NAME,
  SCORING_GROUPS,
  deriveInsight,
  formatPoints,
  parseRules,
  roundPoints,
  scoringSaveError,
  systemNameHint,
  systemNameValue,
} from './scoring-editor'

describe('formatPoints / roundPoints', () => {
  it('signs gains, keeps losses, drops trailing zeros', () => {
    expect(formatPoints(0.04)).toBe('+0.04')
    expect(formatPoints(4)).toBe('+4')
    expect(formatPoints(-2)).toBe('-2')
    expect(formatPoints(0)).toBe('0')
  })
  it('rounds a 0.01 step back to the cent (no float drift)', () => {
    expect(roundPoints(0.04 - 0.01)).toBe(0.03)
    expect(roundPoints(0.1 + 0.2)).toBe(0.3)
    expect(formatPoints(roundPoints(0.04 + 0.01))).toBe('+0.05')
  })
})

describe('parseRules', () => {
  it('fills every missing or bad field from the default preset', () => {
    expect(parseRules(null)).toEqual(PPR_SCORING)
    expect(parseRules({ receptions: 0.5, pass_tds: 'six', rush_tds: Number.NaN })).toEqual({ ...PPR_SCORING, receptions: 0.5 })
    expect(parseRules([1, 2])).toEqual(PPR_SCORING)
  })
})

describe('the groups', () => {
  it('cover every scoring rule exactly once', () => {
    const keys = SCORING_GROUPS.flatMap((g) => g.fields.map((f) => f.key)).sort()
    expect(keys).toEqual(Object.keys(STANDARD_SCORING).sort())
  })
})

describe('deriveInsight', () => {
  it('reads the reception value first', () => {
    expect(deriveInsight(PPR_SCORING).heading).toBe('Your settings favor pass catchers')
    expect(deriveInsight({ ...STANDARD_SCORING, receptions: 0.5 }).heading).toBe('Your settings are close to balanced')
    expect(deriveInsight({ ...STANDARD_SCORING, pass_tds: 6 }).heading).toBe('Your settings favor QBs')
    expect(deriveInsight(STANDARD_SCORING).heading).toBe('Your settings favor RBs')
  })
})

describe('the System name field', () => {
  it('shows your name for a custom system, the preset’s own otherwise', () => {
    expect(systemNameValue('custom', 'Dynasty SF')).toBe('Dynasty SF')
    expect(systemNameValue('half_ppr', 'Dynasty SF')).toBe('Half-PPR')
    expect(systemNameHint('custom')).toBe('Names your custom system across FieldScout.')
    expect(systemNameHint('espn_ppr')).toBe('Platform presets keep their own names.')
    expect(CUSTOM_DEFAULT_NAME).toBe('My custom scoring')
  })
})

describe('scoringSaveError', () => {
  it('words the Pro refusal, else passes the route’s message on', () => {
    expect(scoringSaveError({ code: 'PRO_REQUIRED', error: 'x' })).toBe('Custom scoring is a Pro feature.')
    expect(scoringSaveError({ error: 'Name taken' })).toBe('Name taken')
    expect(scoringSaveError(null)).toBe('Could not save scoring')
  })
})
