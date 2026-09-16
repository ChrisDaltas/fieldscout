/**
 * commish-roster-service.test.ts — the PURE half of the commissioner roster
 * override (M6A task L.E1.10; spec §15.4:1694-1695; migration 127; PROGRESS
 * D351). The same three proofs as the matchup suite, for this family:
 *
 *   - the SCHEMA accepts an absent / blank reason (Q66) — and since
 *     migration 131 (L.E1.15 / F362) so does 127 end-to-end (the stack suite
 *     pins the NULL-reason receipt);
 *   - §15.4:1694's / 127:249's argument order, absent args OMITTED;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard per verb
 *     — a reused `action_id` for a different player / team / verb is a 409.
 *
 * The live half (exclusivity, the lifted-and-named game lock, the lineup
 * sync, the pool mirror, replay) is pgTAP 075.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE,
  COMMISH_ROSTER_FORBIDDEN_MESSAGE,
  commishForceAddDrop,
  commishForceAddDropInputSchema,
  commishMovePlayer,
  commishMovePlayerInputSchema,
} from './commish-roster-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const TEAM_A = 'CE000000-0000-4000-8000-000000000001'
const TEAM_A_LC = 'ce000000-0000-4000-8000-000000000001'
const TEAM_B = 'ce000000-0000-4000-8000-000000000002'
const ACTION = 'AFA00000-0000-4000-8000-000000000031'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000031'

const moveBody = {
  player_id: 'cr-qb1',
  from_team_id: TEAM_A,
  to_team_id: TEAM_B,
  action_id: ACTION,
  reason: 'trade voided after the deadline',
}
const addDropBody = {
  team_id: TEAM_A,
  add_player_id: 'cr-fa1',
  drop_player_id: 'cr-qb1',
  action_id: ACTION,
  reason: 'manager unreachable — IR replacement',
}

describe('commishMovePlayerInputSchema — §15.4:1694', () => {
  it('LOWER-CASES every uuid (R768) and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishMovePlayerInputSchema.parse({ ...moveBody, reason: '\t' })
    expect(parsed.from_team_id).toBe(TEAM_A_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.reason).toBeUndefined()
    const without: Partial<typeof moveBody> = { ...moveBody }
    delete without.reason
    expect(commishMovePlayerInputSchema.safeParse(without).success).toBe(true)
  })

  it('from and to naming the SAME team is a field error on to_team_id (127:690-694, mirrored) — case-insensitively', () => {
    const same = commishMovePlayerInputSchema.safeParse({ ...moveBody, to_team_id: TEAM_A_LC })
    expect(same.success).toBe(false)
    expect(same.success ? null : same.error.issues[0].path).toStrictEqual(['to_team_id'])
  })

  it('player_id is the catalog text id (never a uuid), 501-char reasons and unknown keys are refused', () => {
    expect(commishMovePlayerInputSchema.safeParse({ ...moveBody, player_id: '' }).success).toBe(false)
    expect(commishMovePlayerInputSchema.safeParse({ ...moveBody, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishMovePlayerInputSchema.safeParse({ ...moveBody, team_id: TEAM_A }).success).toBe(false)
  })
})

describe('commishForceAddDropInputSchema — §15.4:1695 / 127:249', () => {
  it('accepts add-only, drop-only and both; accepts an absent / blank reason (Q66)', () => {
    expect(commishForceAddDropInputSchema.safeParse({ team_id: TEAM_A, add_player_id: 'cr-fa1', action_id: ACTION }).success).toBe(true)
    expect(commishForceAddDropInputSchema.safeParse({ team_id: TEAM_A, drop_player_id: 'cr-qb1', action_id: ACTION, reason: '  ' }).success).toBe(true)
    expect(commishForceAddDropInputSchema.parse(addDropBody).team_id).toBe(TEAM_A_LC)
  })

  it('NEITHER add nor drop is a field error (127:699-703, mirrored); add === drop is a field error on drop_player_id', () => {
    const neither = commishForceAddDropInputSchema.safeParse({ team_id: TEAM_A, action_id: ACTION })
    expect(neither.success).toBe(false)
    expect(neither.success ? null : neither.error.issues[0].path).toStrictEqual(['add_player_id'])
    const same = commishForceAddDropInputSchema.safeParse({ ...addDropBody, drop_player_id: 'cr-fa1' })
    expect(same.success).toBe(false)
    expect(same.success ? null : same.error.issues[0].path).toStrictEqual(['drop_player_id'])
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const moveResult = {
  verb: 'commish_move_player',
  action_id: ACTION_LC,
  player_id: 'cr-qb1',
  from_team_id: TEAM_A_LC,
  to_team_id: TEAM_B,
  team_id: TEAM_B,
  add_player_id: null,
  drop_player_id: null,
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000003',
}
const addDropResult = {
  verb: 'commish_force_add_drop',
  action_id: ACTION_LC,
  player_id: null,
  from_team_id: null,
  to_team_id: null,
  team_id: TEAM_A_LC,
  add_player_id: 'cr-fa1',
  drop_player_id: 'cr-qb1',
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000004',
}

describe('commishMovePlayer — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_move_player in §15.4:1694’s order; the reason rides when given and is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: moveResult, error: null })
    expect((await commishMovePlayer(client, LEAGUE, moveBody)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_move_player', {
      p_league_id: LEAGUE,
      p_player_id: 'cr-qb1',
      p_from_team_id: TEAM_A_LC,
      p_to_team_id: TEAM_B,
      p_reason: moveBody.reason,
      p_action_id: ACTION_LC,
    })
    await commishMovePlayer(client, LEAGUE, { ...moveBody, reason: '' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_reason')
  })

  it('never calls the manager’s verb — roster_add_drop keeps every timing gate and is not this route’s door', async () => {
    const { client, rpc } = rpcDouble({ data: moveResult, error: null })
    await commishMovePlayer(client, LEAGUE, moveBody)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_move_player'])
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each message VERBATIM (incl. the transitional reason gate)', async () => {
    expect(await commishMovePlayer(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, moveBody)).toStrictEqual({ status: 403, body: { error: COMMISH_ROSTER_FORBIDDEN_MESSAGE } })
    expect(await commishMovePlayer(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, moveBody)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const lock = 'commish_move_player: cr-qb1 is on team ce… , not ce… (§13.1)'
    expect(await commishMovePlayer(rpcDouble({ data: null, error: { code: 'P0001', message: lock } }).client, LEAGUE, moveBody)).toStrictEqual({ status: 409, body: { error: lock } })
    const gate = 'commish_move_player: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
    expect(await commishMovePlayer(rpcDouble({ data: null, error: { code: '22023', message: gate } }).client, LEAGUE, { ...moveBody, reason: '' })).toStrictEqual({ status: 400, body: { error: gate } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT player / from / to / verb is a 409, never a 200 for a move nobody made', async () => {
    for (const wrong of [
      { ...moveResult, player_id: 'cr-rb1' },
      { ...moveResult, from_team_id: 'ce000000-0000-4000-8000-0000000000ff' },
      { ...moveResult, to_team_id: 'ce000000-0000-4000-8000-0000000000ff' },
      { ...moveResult, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...moveResult, verb: 'commish_force_add_drop' }, // the sibling door’s document, same ledger
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishMovePlayer(client, LEAGUE, moveBody)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE })
    }
  })
})

describe('commishForceAddDrop — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_force_add_drop in 127:249’s order; absent add / drop / reason are OMITTED so the DEFAULT NULLs stand', async () => {
    const { client, rpc } = rpcDouble({ data: addDropResult, error: null })
    expect((await commishForceAddDrop(client, LEAGUE, addDropBody)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_force_add_drop', {
      p_league_id: LEAGUE,
      p_team_id: TEAM_A_LC,
      p_add: 'cr-fa1',
      p_drop: 'cr-qb1',
      p_reason: addDropBody.reason,
      p_action_id: ACTION_LC,
    })
    const dropOnly = rpcDouble({ data: { ...addDropResult, add_player_id: null }, error: null })
    await commishForceAddDrop(dropOnly.client, LEAGUE, { team_id: TEAM_A, drop_player_id: 'cr-qb1', action_id: ACTION })
    expect(dropOnly.rpc.mock.calls[0][1]).toStrictEqual({ p_league_id: LEAGUE, p_team_id: TEAM_A_LC, p_drop: 'cr-qb1', p_action_id: ACTION_LC })
  })

  it('returns 127’s document WHOLE — bypassed[], score_stale and the caps block are not narrowed away', async () => {
    const full = { ...addDropResult, bypassed: ['game_lock:cr-qb1'], score_stale: true, caps: { commissioner_move_not_counted: true } }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishForceAddDrop(client, LEAGUE, addDropBody)).body).toStrictEqual(full)
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each VERBATIM', async () => {
    expect(await commishForceAddDrop(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, addDropBody)).toStrictEqual({ status: 403, body: { error: COMMISH_ROSTER_FORBIDDEN_MESSAGE } })
    expect(await commishForceAddDrop(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, addDropBody)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const full = 'commish_force_add_drop: roster is full (16 of 16) — send a drop in the same call (§13.1)'
    expect(await commishForceAddDrop(rpcDouble({ data: null, error: { code: 'P0001', message: full } }).client, LEAGUE, addDropBody)).toStrictEqual({ status: 409, body: { error: full } })
    const gate = 'commish_force_add_drop: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
    expect(await commishForceAddDrop(rpcDouble({ data: null, error: { code: '22023', message: gate } }).client, LEAGUE, { ...addDropBody, reason: '' })).toStrictEqual({ status: 400, body: { error: gate } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT team / add / drop / verb is a 409', async () => {
    for (const wrong of [
      { ...addDropResult, team_id: TEAM_B },
      { ...addDropResult, add_player_id: 'cr-fa2' },
      { ...addDropResult, drop_player_id: null }, // the original submit was add-only
      { ...addDropResult, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...addDropResult, verb: 'commish_move_player' },
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishForceAddDrop(client, LEAGUE, addDropBody)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE })
    }
  })
})
