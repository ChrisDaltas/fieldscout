/**
 * commish-lineup-service.test.ts — the PURE half of the audited commissioner
 * lineup override (M6A task L.E1.2; spec §15.4:1695; migration 123).
 *
 * THE REASON IS OPTIONAL HERE TOO (Q66 — Chris, 2026-09-16; spec v2.16.41
 * §10.3 / §15.4; migration 131 / L.E1.15 / F362 / R1052). Before the sweep
 * this schema carried `.min(1)` and the cells below refused a missing or
 * blank reason; now they prove the INVERSE — an absent, blank or tab-only
 * reason PASSES (normalised to absent, never `''`) and is OMITTED from the
 * RPC call, while a 501-char or non-string one is still a FIELD error. Every
 * other wire rule is deliberately the same shape as `lineup-service.ts`, and
 * is pinned here so a future edit that "unifies" the two schemas has to
 * break a named cell to do it.
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

describe('commishEditLineupInputSchema — the reason is OPTIONAL (Q66 / L.E1.15)', () => {
  it('accepts the map whole and LOWER-CASES both uuids (R768 — the guard compares against what Postgres wrote)', () => {
    const parsed = commishEditLineupInputSchema.parse(ok)
    expect(parsed.slot_map).toStrictEqual(ok.slot_map)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.team_id).toBe(TEAM_LC)
  })

  it('a MISSING reason is ACCEPTED (Q66 — the inverse of the pre-131 `.min(1)`); the body parses with reason absent', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.reason
    const parsed = commishEditLineupInputSchema.safeParse(without)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.reason).toBeUndefined()
  })

  it('a BLANK / tab-only reason is ACCEPTED and normalised to ABSENT — never to the empty string (the R745 class still decides "blank"; the table CHECK still refuses "")', () => {
    for (const reason of ['', '   ', '\t\t', '\n', ' \t\r\n ']) {
      const parsed = commishEditLineupInputSchema.safeParse({ ...ok, reason })
      expect(parsed.success, JSON.stringify(reason)).toBe(true)
      expect(parsed.data?.reason, JSON.stringify(reason)).toBeUndefined()
    }
  })

  it('the reason is trimmed and bounded at 500 — 501 and a non-string are still FIELD errors, not raises', () => {
    expect(commishEditLineupInputSchema.parse({ ...ok, reason: '  because  ' }).reason).toBe('because')
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(500) }).success).toBe(true)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: null }).success).toBe(false)
    expect(commishEditLineupInputSchema.safeParse({ ...ok, reason: 42 }).success).toBe(false)
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
  it('calls commish_edit_lineup with §15.4’s argument order and sends p_reason when one is given', async () => {
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

  it('OMITS p_reason when the reason is absent or blank — the RPC’s DEFAULT NULL stands; nothing is sent as "" (the L.E1.10 shape)', async () => {
    const { client, rpc } = rpcDouble({ data: { ...goodResult, reason: null }, error: null })
    const without: Partial<typeof ok> = { ...ok }
    delete without.reason
    expect((await commishEditLineup(client, LEAGUE, without)).status).toBe(200)
    expect((await commishEditLineup(client, LEAGUE, { ...ok, reason: ' \t ' })).status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(2)
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('commish_edit_lineup')
      expect(call[1]).not.toHaveProperty('p_reason')
    }
  })

  it('a bad body is a 400 with field errors, and the RPC is never reached — but a blank reason is NOT a bad body', async () => {
    const { client, rpc } = rpcDouble({ data: null, error: null })
    const res = await commishEditLineup(client, LEAGUE, { ...ok, week: 0 })
    expect(res.status).toBe(400)
    const tooLong = await commishEditLineup(client, LEAGUE, { ...ok, reason: 'x'.repeat(501) })
    expect(tooLong.status).toBe(400)
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
