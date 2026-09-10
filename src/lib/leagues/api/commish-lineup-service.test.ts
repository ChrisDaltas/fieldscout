/**
 * commish-lineup-service.test.ts — the PURE half of the audited commissioner
 * lineup override (M6A task L.E1.2; spec §15.4:1695; migration 123).
 *
 * The one thing this suite exists to prove that `lineup-service.test.ts`
 * cannot: THE REASON IS REQUIRED HERE AND OPTIONAL THERE. §15.4:1689's header
 * is "all require `reason`", so the override refuses a missing one at the Zod
 * layer — a FIELD error the form can route — where the manager's verb accepts
 * `undefined` and lets 123/114 decide. Every other wire rule is deliberately
 * the same shape, and is pinned here so a future edit that "unifies" the two
 * schemas has to break a named cell to do it.
 *
 * The live half (the auth matrix, the verbatim lock refusal, the lock
 * exemption actually landing, the no-op writing no audit row, replay) is
 * pgTAP 071 against the real function.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_LINEUP_ACTION_ID_REUSED_MESSAGE,
  commishEditLineup,
  commishEditLineupInputSchema,
} from './commish-lineup-service'

const TEAM = 'BC000000-0000-4000-8000-000000000001'
const TEAM_LC = 'bc000000-0000-4000-8000-000000000001'
const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const ACTION = 'AFA00000-0000-4000-8000-000000000009'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000009'

const ok = {
  team_id: TEAM,
  week: 3,
  slot_map: { 'qb:0': 'p-qb', 'rb:0': 'p-rb1' },
  action_id: ACTION,
  reason: 'manager unreachable — his game had already started',
}

describe('commishEditLineupInputSchema — §15.4:1689, "all require reason"', () => {
  it('accepts the map whole and LOWER-CASES both uuids (R768 — the guard compares against what Postgres wrote)', () => {
    const parsed = commishEditLineupInputSchema.parse(ok)
    expect(parsed.slot_map).toStrictEqual(ok.slot_map)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.team_id).toBe(TEAM_LC)
  })

  it('THE DIFFERENCE FROM set_lineup: a MISSING reason is refused here, where the manager’s schema allows it', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.reason
    expect(commishEditLineupInputSchema.safeParse(without).success).toBe(false)
  })

  it('a BLANK reason is refused — whitespace only is not a reason (the R745 class, mirrored in-body and at the table CHECK)', () => {
    for (const reason of ['', '   ', '\t\t', '\n', ' \t\r\n ', null]) {
      expect(commishEditLineupInputSchema.safeParse({ ...ok, reason }).success, JSON.stringify(reason)).toBe(false)
    }
  })

  it('the reason is trimmed and bounded at 500 — the league_chat bound, so an over-long one is a FIELD error, not a raise', () => {
    expect(commishEditLineupInputSchema.parse({ ...ok, reason: '  because  ' }).reason).toBe('because')
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(500) }).success).toBe(true)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(501) }).success).toBe(false)
  })

  it('team_id rides the BODY and must be a uuid — §15.4 addresses this route at the league, not the team', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.team_id
    expect(commishEditLineupInputSchema.safeParse(without).success).toBe(false)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, team_id: 'nope' }).success).toBe(false)
  })

  it('action_id is REQUIRED — an override is idempotent or it is a double-apply waiting to happen', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.action_id
    expect(commishEditLineupInputSchema.safeParse(without).success).toBe(false)
  })

  it('an EMPTY map is legal (bench everyone is a lineup) and unknown keys are refused (strictObject)', () => {
    expect(commishEditLineupInputSchema.safeParse({ ...ok, slot_map: {} }).success).toBe(true)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, sneaky: 1 }).success).toBe(false)
  })
})

/** A Supabase double whose only job is to record the RPC arguments. */
function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const goodResult = {
  team_id: TEAM_LC,
  week: 3,
  action_id: ACTION_LC,
  slot_map: ok.slot_map,
  moved: [],
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000001',
}

describe('commishEditLineup — the RPC call and the F65(b) identity guard', () => {
  it('calls commish_edit_lineup with §15.4’s argument order and ALWAYS sends p_reason', async () => {
    const { client, rpc } = rpcDouble({ data: goodResult, error: null })
    const res = await commishEditLineup(client, LEAGUE, ok)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_edit_lineup', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_LC,
      p_week: 3,
      p_slot_map: ok.slot_map,
      p_reason: ok.reason,
      p_action_id: ACTION_LC,
    })
  })

  it('never calls the MANAGER’s verb — set_lineup keeps both lock arms and is not this route’s door', async () => {
    const { client, rpc } = rpcDouble({ data: goodResult, error: null })
    await commishEditLineup(client, LEAGUE, ok)
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain('set_lineup')
  })

  it('a bad body is a 400 with field errors, and the RPC is never reached', async () => {
    const { client, rpc } = rpcDouble({ data: null, error: null })
    const res = await commishEditLineup(client, LEAGUE, { ...ok, reason: '   ' })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 123’s document WHOLE — commissioner_action_id and the override keys are not narrowed away', async () => {
    const full = { ...goodResult, bypassed: ['per_player_kickoff_lock'], score_stale: true, score_stale_reason: 'week_final' }
    const { client } = rpcDouble({ data: full, error: null })
    const res = await commishEditLineup(client, LEAGUE, ok)
    expect(res.body).toStrictEqual(full)
  })

  it('F65(b): a replayed action_id naming a DIFFERENT team/week/placement is a 409, never a 200 reporting a lineup nobody set', async () => {
    for (const wrong of [
      { ...goodResult, team_id: 'bc000000-0000-4000-8000-0000000000ff' },
      { ...goodResult, week: 4 },
      { ...goodResult, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...goodResult, slot_map: { 'qb:0': 'someone-else' } },
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishEditLineup(client, LEAGUE, ok)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_LINEUP_ACTION_ID_REUSED_MESSAGE })
    }
  })

  it('the server’s refusal reaches the caller VERBATIM — that text names the player and his kickoff, and IS the UX', async () => {
    const message =
      'commish_edit_lineup: player p-x is not on team T’s roster in league L (§11.1)'
    const { client } = rpcDouble({ data: null, error: { code: 'P0001', message } })
    const res = await commishEditLineup(client, LEAGUE, ok)
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe(message)
  })
})
