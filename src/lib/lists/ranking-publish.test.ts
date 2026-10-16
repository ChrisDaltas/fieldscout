import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_RANKING_SCORING,
  SCORING_FORMATS,
  insertListWithScoring,
  isMissingColumn,
  personaScoringFormat,
  publishPositionsSchema,
  rpcPositions,
  saveScoringFormat,
} from '@/lib/lists/ranking-publish'

/**
 * Publishing a ranking (Chris, 2026-10-15, #33 / #36; migration 190):
 * the wire shape the reorder RPC reads, and the scoring write that must
 * never fail a publish before 190 is pushed — yet never pass "nothing
 * happened" off as saved.
 */

const MISSING_WRITE = { code: 'PGRST204', message: "Could not find the 'scoring_format' column of 'lists' in the schema cache" }
const MISSING_READ = { code: '42703', message: 'column lists.scoring_format does not exist' }

describe('the publish payload', () => {
  it('flags the players this publish added as is_new — and only them', () => {
    const parsed = publishPositionsSchema.parse([
      { playerId: 'a', position: 2 },
      { playerId: 'n', position: 5, isNew: true },
      { playerId: 'b', position: 9, isNew: false },
    ])
    expect(rpcPositions(parsed)).toEqual([
      { player_id: 'a', position: 2 },
      { player_id: 'n', position: 5, is_new: true },
      { player_id: 'b', position: 9 },
    ])
  })
  it('keeps the reorder body’s rules', () => {
    expect(publishPositionsSchema.safeParse([]).success).toBe(false)
    expect(publishPositionsSchema.safeParse([{ playerId: 'a', position: 0 }]).success).toBe(false)
    expect(publishPositionsSchema.safeParse([{ playerId: 'a', position: 1, isNew: 'yes' }]).success).toBe(false)
  })
})

describe('the scoring vocabulary (the contract Community filters on)', () => {
  it('is exactly the four values the CHECK in 190 allows', () => {
    expect(SCORING_FORMATS).toEqual(['ppr', 'half', 'quarter', 'standard'])
  })
  it('no scoring chosen is Half PPR (Chris, 2026-10-16)', () => {
    expect(DEFAULT_RANKING_SCORING).toBe('half')
  })
  it('maps an AI persona’s default scoring — none, or one outside the vocabulary, is Half PPR', () => {
    expect(
      ['PPR', 'Half-PPR', 'Half PPR', 'Standard', 'Superflex', '', null, undefined].map(personaScoringFormat),
    ).toEqual(['ppr', 'half', 'half', 'standard', 'half', 'half', 'half', 'half'])
  })
})

describe('isMissingColumn', () => {
  it('is the column not pushed yet — for a write (PGRST204) or a read (42703) — and only that column', () => {
    expect(isMissingColumn(MISSING_WRITE, 'scoring_format')).toBe(true)
    expect(isMissingColumn(MISSING_READ, 'scoring_format')).toBe(true)
    expect(isMissingColumn(MISSING_WRITE, 'previous_position')).toBe(false)
    expect(isMissingColumn({ code: '23514', message: 'scoring_format check' }, 'scoring_format')).toBe(false)
    expect(isMissingColumn(null, 'scoring_format')).toBe(false)
  })
})

function client(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; update?: unknown; eq?: [string, unknown] } = {}
  const builder = {
    update: (row: unknown) => ((calls.update = row), builder),
    eq: (col: string, v: unknown) => ((calls.eq = [col, v]), builder),
    select: () => Promise.resolve(result),
  }
  const supabase = { from: (t: string) => ((calls.table = t), builder) } as unknown as SupabaseClient
  return { supabase, calls }
}

describe('saveScoringFormat', () => {
  it('saves it on the board', async () => {
    const { supabase, calls } = client({ data: [{ id: 'L1' }], error: null })
    await expect(saveScoringFormat(supabase, 'L1', 'quarter')).resolves.toBe('saved')
    expect(calls).toEqual({ table: 'lists', update: { scoring_format: 'quarter' }, eq: ['id', 'L1'] })
  })
  it('before 190 is pushed: unsupported, never a failure', async () => {
    const { supabase } = client({ data: null, error: MISSING_WRITE })
    await expect(saveScoringFormat(supabase, 'L1', 'ppr')).resolves.toBe('unsupported')
  })
  it('an update that matched no row is a failure, not "saved"', async () => {
    const { supabase } = client({ data: [], error: null })
    await expect(saveScoringFormat(supabase, 'L1', 'ppr')).rejects.toThrow(/not found/)
  })
  it('any other error is a failure', async () => {
    const { supabase } = client({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(saveScoringFormat(supabase, 'L1', 'ppr')).rejects.toThrow('permission denied')
  })
})

describe('insertListWithScoring (the AI expert board writers)', () => {
  const row = { owner_id: 'o', title: 't', slug: 's', scoring_format: 'half' as const }

  it('inserts with the scoring', async () => {
    const insert = vi.fn(async () => ({ data: { id: 'L1' }, error: null }))
    await expect(insertListWithScoring(insert, row)).resolves.toEqual({ data: { id: 'L1' }, error: null })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(row)
  })
  it('before 190 is pushed: retries once without it', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: MISSING_WRITE })
      .mockResolvedValueOnce({ data: { id: 'L1' }, error: null })
    await expect(insertListWithScoring(insert, row)).resolves.toEqual({ data: { id: 'L1' }, error: null })
    expect(insert).toHaveBeenLastCalledWith({ owner_id: 'o', title: 't', slug: 's' })
  })
  it('any other error comes back as is, with no retry', async () => {
    const err = { code: '23505', message: 'duplicate key' }
    const insert = vi.fn(async () => ({ data: null, error: err }))
    await expect(insertListWithScoring(insert, row)).resolves.toEqual({ data: null, error: err })
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
