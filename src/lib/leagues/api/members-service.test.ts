/**
 * members-service.test.ts — L.E1.40 (F262(a) / F546; PROGRESS D461): the
 * removal body's schema and the retire identity guard over an INJECTED client
 * (the stack suite `members-retire-api-db.test.ts` drives the real wire).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { RETIRE_ACTION_ID_REUSED_MESSAGE, removeMember, removeMemberInputSchema } from './members-service'

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

describe('removeMemberInputSchema — the retire action_id and the optional reason', () => {
  it('retire needs an action_id; the other modes refuse one', () => {
    expect(removeMemberInputSchema.safeParse({ mode: 'retire' }).success).toBe(false)
    expect(removeMemberInputSchema.safeParse({ mode: 'retire', action_id: ACTION }).success).toBe(true)
    expect(removeMemberInputSchema.safeParse({ mode: 'vacate', action_id: ACTION }).success).toBe(false)
    expect(removeMemberInputSchema.safeParse({ mode: 'takeover', successor_user_id: ACTION, action_id: ACTION }).success).toBe(false)
  })

  it('the reason is optional: blank is absent, trimmed when given, 501 refused (Q66 — optionalReason)', () => {
    expect(removeMemberInputSchema.parse({ mode: 'retire', action_id: ACTION, reason: '   ' }).reason).toBeUndefined()
    expect(removeMemberInputSchema.parse({ mode: 'retire', action_id: ACTION, reason: ' away ' }).reason).toBe('away')
    expect(removeMemberInputSchema.safeParse({ mode: 'retire', action_id: ACTION, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(removeMemberInputSchema.safeParse({ mode: 'retire', action_id: ACTION, reason: 'x'.repeat(500) }).success).toBe(true)
  })

  it('the action_id is lower-cased before the RPC and the guard see it (R768)', () => {
    expect(removeMemberInputSchema.parse({ mode: 'retire', action_id: ACTION.toUpperCase() }).action_id).toBe(ACTION)
  })
})

describe('removeMember — retire through the RPC', () => {
  it('passes the action_id and omits an absent reason', async () => {
    const { client, calls } = fakeClient({ verb: 'retire_franchise', action_id: ACTION, member_id: MEMBER })
    const res = await removeMember(client, LEAGUE, MEMBER, 'me', { mode: 'retire', action_id: ACTION })
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      { fn: 'remove_manager', args: { p_league_id: LEAGUE, p_member_id: MEMBER, p_mode: 'retire', p_action_id: ACTION } },
    ])
  })

  it('F65(b): a 200 whose stored result is another seat or another stamp is a 409, never reported as this retirement', async () => {
    for (const payload of [
      { verb: 'retire_franchise', action_id: ACTION, member_id: 'a1400000-0000-4000-8000-0000000000ff' },
      { verb: 'retire_franchise', action_id: 'a1400000-0000-4000-8000-0000000000fe', member_id: MEMBER },
      { verb: 'vacate_seat', action_id: ACTION, member_id: MEMBER },
    ]) {
      const { client } = fakeClient(payload)
      const res = await removeMember(client, LEAGUE, MEMBER, 'me', { mode: 'retire', action_id: ACTION })
      expect(res).toEqual({ status: 409, body: { error: RETIRE_ACTION_ID_REUSED_MESSAGE } })
    }
  })

  it('vacate is never held to the retire guard (its seven-key result carries no verb)', async () => {
    const { client } = fakeClient({ ok: true, mode: 'vacate', member_id: MEMBER })
    expect((await removeMember(client, LEAGUE, MEMBER, 'me', { mode: 'vacate' })).status).toBe(200)
  })
})
