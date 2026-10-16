import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createListSchema,
  legacyFlagsToRankingMode,
  RANKING_MODES,
  rankingModeToLegacyFlags,
  updateListSchema,
} from '@/types/schemas/lists'

import * as rankingMode from './ranking-mode'
import {
  groupingWrite,
  hasTiers,
  isNumbered,
  isRankingMode,
  isTierOnlyUnavailable,
  isTierOnlyUnavailableResponse,
  listKindOf,
  numbersWrite,
  rankingModeOf,
  TIER_ONLY_UNAVAILABLE_BODY,
  TIER_ONLY_UNAVAILABLE_STATUS,
  withNumbers,
  withTiers,
} from './ranking-mode'

/**
 * Tiers without numbers (Chris, 2026-10-15; migration 191). The Ranked and
 * Tiers switches are independent; `lists.ranking_mode` stores the pair as one
 * of four values, and the app and the database must agree on all four.
 */

const MIGRATION = 'supabase/migrations/191_list_tier_only_mode.sql'

describe('the four modes match migration 191’s CHECK', () => {
  it('the same four values, in the same order', () => {
    const sql = readFileSync(path.resolve(process.cwd(), MIGRATION), 'utf8')
    const check = /CONSTRAINT lists_ranking_mode_check\s+CHECK \(ranking_mode IN \(([^)]*)\)\)/.exec(sql)
    expect(check, 'migration 191 carries the lists_ranking_mode_check IN (…) CHECK').not.toBeNull()
    const modes = check![1].split(',').map((m) => m.trim().replace(/^'|'$/g, ''))
    expect(modes).toEqual([...RANKING_MODES])
  })

  it('the API’s schemas accept every mode and nothing else', () => {
    for (const mode of RANKING_MODES) {
      expect(createListSchema.safeParse({ title: 'x', ranking_mode: mode }).success, mode).toBe(true)
      expect(updateListSchema.safeParse({ ranking_mode: mode }).success, mode).toBe(true)
    }
    expect(createListSchema.safeParse({ title: 'x', ranking_mode: 'tiers' }).success).toBe(false)
    expect(updateListSchema.safeParse({ ranking_mode: 'Tier_Only' }).success).toBe(false)
  })
})

describe('the switches', () => {
  const table = [
    // mode,           Ranked, Tiers, kind
    ['unranked', false, false, 'List'],
    ['ranked', true, false, 'Ranking'],
    ['rank_and_tier', true, true, 'Ranking'],
    ['tier_only', false, true, 'Tiers'],
  ] as const

  it.each(table)('%s: Ranked %s, Tiers %s, "%s"', (mode, numbered, tiers, kind) => {
    expect(isNumbered(mode)).toBe(numbered)
    expect(hasTiers(mode)).toBe(tiers)
    expect(rankingModeOf({ numbered, tiers })).toBe(mode)
    expect(listKindOf(mode)).toBe(kind)
    expect(isRankingMode(mode)).toBe(true)
  })

  it('a row with no mode reads as the column default (ranked)', () => {
    expect(isNumbered(undefined)).toBe(true)
    expect(isNumbered(null)).toBe(true)
    expect(hasTiers(undefined)).toBe(false)
    expect(isRankingMode('tiers')).toBe(false)
  })

  it('each switch flips alone — the other half stays (no more "Tiers turns Ranked on")', () => {
    // Tiers on.
    expect(withTiers('unranked', true)).toBe('tier_only')
    expect(withTiers('ranked', true)).toBe('rank_and_tier')
    // Tiers off.
    expect(withTiers('tier_only', false)).toBe('unranked')
    expect(withTiers('rank_and_tier', false)).toBe('ranked')
    // Ranked off.
    expect(withNumbers('rank_and_tier', false)).toBe('tier_only')
    expect(withNumbers('ranked', false)).toBe('unranked')
    // Ranked on.
    expect(withNumbers('tier_only', true)).toBe('rank_and_tier')
    expect(withNumbers('unranked', true)).toBe('ranked')
  })
})

describe('one numbering rule, phone and desktop (Chris, 2026-10-16)', () => {
  it('numbers only on a numbered list — a plain list has none, on desktop too', () => {
    expect(isNumbered('unranked')).toBe(false)
    expect(isNumbered('tier_only')).toBe(false)
    expect(isNumbered('ranked')).toBe(true)
    expect(isNumbered('rank_and_tier')).toBe(true)
  })

  it('there is no desktop-only exception left to drift from it', () => {
    expect(Object.keys(rankingMode)).not.toContain('showsNumbersOnDesktop')
  })
})

describe('the desktop grouping control writes only the Tiers switch', () => {
  it('Tier turns tiers on, Rank turns them off, numbering stays', () => {
    expect(groupingWrite('ranked', 'tier')).toBe('rank_and_tier')
    expect(groupingWrite('unranked', 'tier')).toBe('tier_only')
    expect(groupingWrite('rank_and_tier', 'rank')).toBe('ranked')
    expect(groupingWrite('tier_only', 'rank')).toBe('unranked')
  })

  it('a pick that changes nothing, or a label-only grouping, writes nothing', () => {
    expect(groupingWrite('rank_and_tier', 'tier')).toBeNull()
    expect(groupingWrite('tier_only', 'tier')).toBeNull()
    expect(groupingWrite('ranked', 'rank')).toBeNull()
    expect(groupingWrite('unranked', 'rank')).toBeNull()
    for (const org of ['round', 'cost', 'budget']) {
      expect(groupingWrite('ranked', org), org).toBeNull()
      expect(groupingWrite('tier_only', org), org).toBeNull()
    }
  })

  it('once the server said tier-only is not here yet, a Basic list’s Tier pick stays session-only', () => {
    const unavailable = { tierOnlyUnavailable: true }
    expect(groupingWrite('unranked', 'tier', unavailable)).toBeNull()
    // Everything that never writes tier_only still writes.
    expect(groupingWrite('ranked', 'tier', unavailable)).toBe('rank_and_tier')
    expect(groupingWrite('rank_and_tier', 'rank', unavailable)).toBe('ranked')
    expect(groupingWrite('tier_only', 'rank', unavailable)).toBe('unranked')
  })
})

/**
 * A Basic list lost its desktop numbers with the ruling, so the desktop list
 * menu carries the Ranked switch the phone editor has (Numbers → Ranked /
 * Unranked): the owner can still turn them back on after create.
 */
describe('the desktop Numbers choice writes only the Ranked switch', () => {
  it('Ranked turns numbers on, Unranked turns them off, tiers stay', () => {
    expect(numbersWrite('unranked', true)).toBe('ranked')
    expect(numbersWrite('tier_only', true)).toBe('rank_and_tier')
    expect(numbersWrite('ranked', false)).toBe('unranked')
    expect(numbersWrite('rank_and_tier', false)).toBe('tier_only')
  })

  it('a pick that changes nothing writes nothing', () => {
    expect(numbersWrite('ranked', true)).toBeNull()
    expect(numbersWrite('rank_and_tier', true)).toBeNull()
    expect(numbersWrite('unranked', false)).toBeNull()
    expect(numbersWrite('tier_only', false)).toBeNull()
  })
})

describe('the legacy flag pair', () => {
  it('is hide_order = no numbers, tiers_enabled = tiers — and round-trips', () => {
    for (const mode of RANKING_MODES) {
      const flags = rankingModeToLegacyFlags(mode)
      expect(flags).toEqual({ hide_order: !isNumbered(mode), tiers_enabled: hasTiers(mode) })
      expect(legacyFlagsToRankingMode(flags)).toBe(mode)
    }
    expect(rankingModeToLegacyFlags('tier_only')).toEqual({ hide_order: true, tiers_enabled: true })
  })
})

describe('before migration 191 is pushed', () => {
  it('recognises the older CHECK refusing the value', () => {
    expect(
      isTierOnlyUnavailable({
        code: '23514',
        message: 'new row for relation "lists" violates check constraint "lists_ranking_mode_check"',
      }),
    ).toBe(true)
  })

  it('is anchored: other 23514s and other errors are not it', () => {
    expect(isTierOnlyUnavailable({ code: '23514', message: 'Free accounts can have one private list.' })).toBe(false)
    expect(
      isTierOnlyUnavailable({
        code: '23514',
        message: 'new row for relation "lists" violates check constraint "lists_cover_color_check"',
      }),
    ).toBe(false)
    expect(isTierOnlyUnavailable({ code: '23505', message: 'lists_ranking_mode_check' })).toBe(false)
    expect(isTierOnlyUnavailable(null)).toBe(false)
  })

  it('the client recognises that answer by its code, and nothing else', () => {
    const fromApi = Object.assign(new Error(TIER_ONLY_UNAVAILABLE_BODY.error), {
      status: 409,
      code: TIER_ONLY_UNAVAILABLE_BODY.code,
    })
    expect(isTierOnlyUnavailableResponse(fromApi)).toBe(true)
    expect(isTierOnlyUnavailableResponse(Object.assign(new Error('x'), { status: 409 }))).toBe(false)
    expect(isTierOnlyUnavailableResponse(Object.assign(new Error('x'), { code: 'LIST_NOT_FOUND' }))).toBe(false)
    expect(isTierOnlyUnavailableResponse(new Error(TIER_ONLY_UNAVAILABLE_BODY.error))).toBe(false)
    expect(isTierOnlyUnavailableResponse(null)).toBe(false)
    expect(isTierOnlyUnavailableResponse('TIER_ONLY_UNAVAILABLE')).toBe(false)
  })

  it('answers with a clear 409 that names the feature', () => {
    expect(TIER_ONLY_UNAVAILABLE_STATUS).toBe(409)
    expect(TIER_ONLY_UNAVAILABLE_BODY.code).toBe('TIER_ONLY_UNAVAILABLE')
    expect(TIER_ONLY_UNAVAILABLE_BODY.error).toBe('Tiers without numbers is coming in the next update.')
  })
})
