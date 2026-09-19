/**
 * lineup-service.test.ts — the PURE half of the lineup route (M4 task
 * L.D4.1; F224(e)): the wire schema's shape and the placement half of the
 * F65(b) identity guard. The live half (auth matrix, the verbatim lock
 * refusal, replay, reuse) is `lineup-api-db.test.ts` over the stack.
 */
import { describe, expect, it } from 'vitest'

import { placementMatches, setLineup, setLineupInputSchema } from './lineup-service'

const QB = 'p-qb'
const RB1 = 'p-rb1'
const RB2 = 'p-rb2'
const WR1 = 'p-wr1'
const IR = 'p-ir'

describe('setLineupInputSchema — the FULL canonical map, one action_id, an optional reason (F224(e))', () => {
  const ok = {
    week: 3,
    slot_map: { 'qb:0': QB, 'rb:0': RB1, 'ir:0': IR },
    action_id: 'AFA00000-0000-4000-8000-000000000001',
  }

  it('accepts the map whole and LOWER-CASES the action_id (R768)', () => {
    const parsed = setLineupInputSchema.parse(ok)
    expect(parsed.slot_map).toStrictEqual(ok.slot_map)
    expect(parsed.action_id).toBe('afa00000-0000-4000-8000-000000000001')
    expect(parsed.reason).toBeUndefined()
  })

  it('an EMPTY map is legal — bench everyone / clear IR is a lineup (112 accepts {})', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: {} }).success).toBe(true)
  })

  it('an empty slot is an ABSENT key — a null value is refused here before 112 refuses it with 22023', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': null } }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': '' } }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': 7 } }).success).toBe(false)
  })

  it('week is an integer on the NFL calendar (1–18); the league\'s own bounds are 112\'s 404-class refusal', () => {
    for (const week of [0, 19, 1.5, '3', null]) {
      expect(setLineupInputSchema.safeParse({ ...ok, week }).success, String(week)).toBe(false)
    }
    expect(setLineupInputSchema.safeParse({ ...ok, week: 1 }).success).toBe(true)
    expect(setLineupInputSchema.safeParse({ ...ok, week: 18 }).success).toBe(true)
  })

  it('action_id is REQUIRED and a uuid', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.action_id
    expect(setLineupInputSchema.safeParse(without).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, action_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('reason is optional, trimmed, ≤ 500 (the league_chat bound 112 enforces too)', () => {
    expect(setLineupInputSchema.parse({ ...ok, reason: '  manager away  ' }).reason).toBe('manager away')
    expect(setLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, reason: null }).success).toBe(true)
  })

  // F363(b) / Q66 (M6A L.E1.12): since migration 131 `set_lineup`'s
  // commissioner arm normalises a blank reason to NULL, so the route must not
  // 400 one at the field level. PROBE: restore `.min(1)` on `lineupReason` →
  // this cell reds on the blank and tab-only rows.
  it('a BLANK or whitespace-only reason is ACCEPTED and normalised to ABSENT — never refused, never `\'\'` on the wire (Q66 / F363(b))', () => {
    for (const blank of ['', ' ', '\t', ' \t\r\n ']) {
      const parsed = setLineupInputSchema.safeParse({ ...ok, reason: blank })
      expect(parsed.success, JSON.stringify(blank)).toBe(true)
      expect(parsed.success && parsed.data.reason, JSON.stringify(blank)).toBeUndefined()
    }
    // null and absent land on the same value as blank: one shape downstream.
    expect(setLineupInputSchema.parse({ ...ok, reason: null }).reason).toBeUndefined()
    expect(setLineupInputSchema.parse(ok).reason).toBeUndefined()
  })

  it('the bound and the type still hold: 500 passes, 501 and a non-string are field errors (the trim runs BEFORE the bound)', () => {
    expect(setLineupInputSchema.parse({ ...ok, reason: 'x'.repeat(500) }).reason).toHaveLength(500)
    expect(setLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(501) }).success).toBe(false)
    // 500 real characters inside padding: trimmed first, so it fits.
    expect(setLineupInputSchema.parse({ ...ok, reason: `  ${'x'.repeat(500)}  ` }).reason).toHaveLength(500)
    for (const bad of [7, true, {}, ['why']]) {
      expect(setLineupInputSchema.safeParse({ ...ok, reason: bad }).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('is STRICT — a stray key (a client-supplied starters[] or locked_at) is refused, not ignored', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, starters: [] }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, locked_at: null }).success).toBe(false)
  })
})

describe('placementMatches — the placement half of the F65(b) guard', () => {
  it('a map honored VERBATIM matches', () => {
    const map = { 'qb:0': QB, 'rb:0': RB1, 'rb:1': RB2 }
    expect(placementMatches(map, { ...map }, [])).toBe(true)
  })

  it('a re-seat named in moved[] matches (E16: from = the submitted key)', () => {
    const submitted = { 'flex:0': WR1, 'wr:0': RB1 }
    const canonical = { 'wr:0': WR1, 'rb:0': RB1 }
    const moved = [
      { player_id: WR1, from: 'flex:0', to: 'wr:0' },
      { player_id: RB1, from: 'wr:0', to: 'rb:0' },
    ]
    expect(placementMatches(submitted, canonical, moved)).toBe(true)
  })

  it('a re-seat NOT named in moved[] does not match — the map came from a different submit', () => {
    const submitted = { 'flex:0': WR1, 'wr:0': RB1 }
    const canonical = { 'wr:0': WR1, 'rb:0': RB1 }
    expect(placementMatches(submitted, canonical, [])).toBe(false)
    expect(placementMatches(submitted, canonical, [{ player_id: WR1, from: 'wr:1', to: 'wr:0' }])).toBe(false)
  })

  it('a swapped player is refused even when every surviving key still matches', () => {
    const submitted = { 'qb:0': QB, 'rb:0': RB1 }
    expect(placementMatches(submitted, { 'qb:0': QB, 'rb:0': RB2 }, [])).toBe(false)
  })

  it('a superset or subset of players is refused — an IR removal is a different lineup from an IR placement', () => {
    expect(placementMatches({ 'qb:0': QB }, { 'qb:0': QB, 'ir:0': IR }, [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB, 'ir:0': IR }, { 'qb:0': QB }, [])).toBe(false)
  })

  it('a non-object canonical map never matches', () => {
    expect(placementMatches({ 'qb:0': QB }, null, [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB }, [], [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB }, 'qb', [])).toBe(false)
  })

  it('an empty submit matches an empty canonical map and nothing else', () => {
    expect(placementMatches({}, {}, [])).toBe(true)
    expect(placementMatches({}, { 'qb:0': QB }, [])).toBe(false)
  })
})

describe('setLineup — what reaches `set_lineup` when the reason is blank (Q66 / F363(b), M6A L.E1.12)', () => {
  const TEAM = 'aaaaaaaa-0000-4000-8000-000000000001'
  const ACTION = 'afa00000-0000-4000-8000-000000000002'
  const slot_map = { 'qb:0': QB }

  /** An injected client (D68/D71) that records the RPC args and answers with
   *  THIS submit's document, so the F65(b) guard passes and the status is the
   *  schema's doing alone. */
  function fakeClient() {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return { data: { team_id: TEAM, week: 3, action_id: ACTION, slot_map, moved: [] }, error: null }
      },
    }
    return { client: client as unknown as Parameters<typeof setLineup>[0], calls }
  }

  it('a blank reason is a 200 and `p_reason` is OMITTED (112 defaults it to NULL; 131 stores NULL) — not a 400, not an empty string', async () => {
    for (const reason of ['', ' \t ', null, undefined]) {
      const { client, calls } = fakeClient()
      const body = { week: 3, slot_map, action_id: ACTION, ...(reason === undefined ? {} : { reason }) }
      const res = await setLineup(client, 'league-1', TEAM, body)
      expect(res.status, JSON.stringify(reason)).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0].fn).toBe('set_lineup')
      expect('p_reason' in calls[0].args, JSON.stringify(reason)).toBe(false)
    }
  })

  it('a real reason still rides, TRIMMED; an over-long one is a 400 that never reaches the RPC', async () => {
    const given = fakeClient()
    await setLineup(given.client, 'league-1', TEAM, { week: 3, slot_map, action_id: ACTION, reason: '  manager away  ' })
    expect(given.calls[0].args.p_reason).toBe('manager away')

    const long = fakeClient()
    const res = await setLineup(long.client, 'league-1', TEAM, { week: 3, slot_map, action_id: ACTION, reason: 'x'.repeat(501) })
    expect(res.status).toBe(400)
    expect(long.calls).toHaveLength(0)
  })
})
