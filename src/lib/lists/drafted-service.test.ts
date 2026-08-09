/**
 * drafted-service.test.ts — **LV.1.2** unit pins for the parts of the drafted
 * surface that need no database: the wire contract, and the guards that must
 * short-circuit BEFORE any query runs.
 *
 * The behavioral matrix (RLS isolation, idempotency, the Saved-list case)
 * lives in `drafted-api-db.test.ts` against the real stack; pgTAP 028 owns
 * the DB-side matrix. What is pinned here instead:
 *
 *   * **The body shape is a desired STATE, not a toggle.** D2's marks have to
 *     survive an optimistic checkbox retrying — a blind `{player_id}` toggle
 *     applied twice lands on the wrong answer with nothing to notice it. If a
 *     later change "simplifies" the contract back to a toggle, these pins go
 *     red rather than shipping a silent inversion bug.
 *   * **A malformed list id never reaches the database.** Proven with a
 *     client that throws on ANY property access — if a guard is removed, the
 *     test fails with that client's own message rather than passing on a
 *     lucky 404 from PostgREST.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  clearDrafted,
  LIST_NOT_FOUND_MESSAGE,
  listDrafted,
  setDrafted,
  setDraftedInputSchema,
} from './drafted-service'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const VALID_LIST_ID = '22222222-2222-4222-8222-222222222222'

/** Any use at all is a failure — the guards under test must return first. */
const noDatabase = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `drafted-service touched the database (.${String(prop)}) for an input it should have rejected outright`,
      )
    },
  },
) as unknown as SupabaseClient<Database>

describe('setDraftedInputSchema — the wire contract', () => {
  it('accepts an explicit desired state in both directions', () => {
    expect(setDraftedInputSchema.parse({ player_id: 'p1', drafted: true })).toEqual({
      player_id: 'p1',
      drafted: true,
    })
    expect(setDraftedInputSchema.parse({ player_id: 'p1', drafted: false })).toEqual({
      player_id: 'p1',
      drafted: false,
    })
  })

  it('REJECTS a toggle-shaped body with no desired state', () => {
    // The pin that defends D2's retry-safety. A body carrying only a player
    // id is a toggle, and a toggle is not idempotent.
    expect(setDraftedInputSchema.safeParse({ player_id: 'p1' }).success).toBe(false)
  })

  it('rejects a non-boolean drafted, so "false" cannot mean true', () => {
    expect(setDraftedInputSchema.safeParse({ player_id: 'p1', drafted: 'false' }).success).toBe(
      false,
    )
    expect(setDraftedInputSchema.safeParse({ player_id: 'p1', drafted: 0 }).success).toBe(false)
  })

  it('rejects an empty or over-long player id', () => {
    expect(setDraftedInputSchema.safeParse({ player_id: '', drafted: true }).success).toBe(false)
    expect(
      setDraftedInputSchema.safeParse({ player_id: 'x'.repeat(129), drafted: true }).success,
    ).toBe(false)
  })

  it('accepts the TEXT player ids the players table actually carries', () => {
    // `players.id` is a provider string, not a UUID — the schema must not
    // tighten to UUID or every real player becomes unmarkable.
    expect(setDraftedInputSchema.safeParse({ player_id: '00-0034857', drafted: true }).success).toBe(
      true,
    )
  })

  it('rejects a missing or non-object body', () => {
    expect(setDraftedInputSchema.safeParse(null).success).toBe(false)
    expect(setDraftedInputSchema.safeParse(undefined).success).toBe(false)
    expect(setDraftedInputSchema.safeParse('p1').success).toBe(false)
  })
})

describe('a malformed list id is rejected before any query', () => {
  it('listDrafted 404s without touching the database', async () => {
    const result = await listDrafted(noDatabase, 'not-a-uuid', USER_ID)
    expect(result).toEqual({ status: 404, body: { error: LIST_NOT_FOUND_MESSAGE } })
  })

  it('setDrafted 404s without touching the database', async () => {
    const result = await setDrafted(noDatabase, 'not-a-uuid', USER_ID, {
      player_id: 'p1',
      drafted: true,
    })
    expect(result).toEqual({ status: 404, body: { error: LIST_NOT_FOUND_MESSAGE } })
  })

  it('clearDrafted 404s without touching the database', async () => {
    const result = await clearDrafted(noDatabase, 'not-a-uuid', USER_ID)
    expect(result).toEqual({ status: 404, body: { error: LIST_NOT_FOUND_MESSAGE } })
  })
})

describe('a malformed body is rejected before any query', () => {
  it('setDrafted 400s on a toggle-shaped body without touching the database', async () => {
    const result = await setDrafted(noDatabase, VALID_LIST_ID, USER_ID, { player_id: 'p1' })
    expect(result.status).toBe(400)
    expect(result.body).toHaveProperty('error')
  })

  it('setDrafted 400s on a null body without touching the database', async () => {
    const result = await setDrafted(noDatabase, VALID_LIST_ID, USER_ID, null)
    expect(result.status).toBe(400)
  })
})
