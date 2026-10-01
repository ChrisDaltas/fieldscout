/**
 * members-service.test.ts — the removal body's schema over an INJECTED
 * client. L.E1.42 (PROGRESS D467): retire is refused by the route itself
 * (the stack suite `members-retire-api-db.test.ts` drives the real wire).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { RETIRE_REMOVED_MESSAGE, removeMember, removeMemberInputSchema } from './members-service'

const LEAGUE = 'a1400000-0000-4000-8000-000000000001'
const MEMBER = 'a1400000-0000-4000-8000-000000000002'
const ACTION = 'a1400000-0000-4000-8000-000000000003'

/** A client whose seat read says "someone else's seat" and whose RPC answers `rpcData`. */
function fakeClient(rpcData: unknown) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { id: MEMBER, user_id: 'someone-else' }, error: null }),
  }
  const client = {
    from: () => chain,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: rpcData, error: null }
    },
  }
  return { client: client as unknown as SupabaseClient<Database>, calls }
}

describe('removeMemberInputSchema — two outcomes and the optional reason', () => {
  it('L.E1.42: only takeover and vacate parse; retire and an action_id do not', () => {
    expect(removeMemberInputSchema.safeParse({ mode: 'vacate' }).success).toBe(true)
    expect(removeMemberInputSchema.safeParse({ mode: 'takeover', successor_user_id: ACTION }).success).toBe(true)
    expect(removeMemberInputSchema.safeParse({ mode: 'retire', action_id: ACTION }).success).toBe(false)
    expect(removeMemberInputSchema.safeParse({ mode: 'vacate', action_id: ACTION }).success).toBe(false)
  })

  it('the reason is optional: blank is absent, trimmed when given, 501 refused (Q66 — optionalReason)', () => {
    expect(removeMemberInputSchema.parse({ mode: 'vacate', reason: '   ' }).reason).toBeUndefined()
    expect(removeMemberInputSchema.parse({ mode: 'vacate', reason: ' away ' }).reason).toBe('away')
    expect(removeMemberInputSchema.safeParse({ mode: 'vacate', reason: 'x'.repeat(501) }).success).toBe(false)
    expect(removeMemberInputSchema.safeParse({ mode: 'vacate', reason: 'x'.repeat(500) }).success).toBe(true)
  })
})

describe('removeMember — retire is refused before the database (L.E1.42)', () => {
  it('a retire request is a 400 in plain words and never reaches the RPC (degrade-before-push)', async () => {
    for (const body of [{ mode: 'retire' }, { mode: 'retire', action_id: ACTION }, { mode: 'retire', reason: 'moving away' }]) {
      const { client, calls } = fakeClient({ verb: 'retire_franchise', action_id: ACTION, member_id: MEMBER })
      const res = await removeMember(client, LEAGUE, MEMBER, 'me', body)
      expect(res).toEqual({ status: 400, body: { error: RETIRE_REMOVED_MESSAGE } })
      expect(calls).toEqual([])
    }
    expect(RETIRE_REMOVED_MESSAGE).toBe('A team can’t be retired — seat a new manager or leave it vacant.')
  })

  it('vacate still goes through the RPC with its mode only', async () => {
    const { client, calls } = fakeClient({ ok: true, mode: 'vacate', member_id: MEMBER })
    expect((await removeMember(client, LEAGUE, MEMBER, 'me', { mode: 'vacate' })).status).toBe(200)
    expect(calls).toEqual([{ fn: 'remove_manager', args: { p_league_id: LEAGUE, p_member_id: MEMBER, p_mode: 'vacate' } }])
  })
})
