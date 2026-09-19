/**
 * commish-schedule-service.test.ts — the PURE half of the commissioner
 * schedule override (M6A task L.E1.11; spec §15.4:1700; migration 130 via
 * 131; PROGRESS D351). The part-1 suites' three proofs, for this verb:
 *
 *   - the SCHEMA accepts an absent / blank reason (Q66) and LOWER-CASES
 *     every uuid (R768); home === away is a field error (130:338 mirrored);
 *   - 130:781's argument order, an absent reason OMITTED;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard — a
 *     reused `action_id` for a different matchup / pairing / verb is a 409.
 *
 * The live half (the lifted gates named in `bypassed[]`, the sibling
 * re-pairing, the receipt) is pgTAP 078 + the stack suite.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE,
  COMMISH_SCHEDULE_FORBIDDEN_MESSAGE,
  commishEditSchedule,
  commishEditScheduleInputSchema,
} from './commish-schedule-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const MATCHUP = 'DF000000-0000-4000-8000-000000000021'
const MATCHUP_LC = 'df000000-0000-4000-8000-000000000021'
const TEAM_A = 'CE000000-0000-4000-8000-000000000001'
const TEAM_A_LC = 'ce000000-0000-4000-8000-000000000001'
const TEAM_B = 'ce000000-0000-4000-8000-000000000002'
const TEAM_C = 'ce000000-0000-4000-8000-000000000003'
const ACTION = 'AFA00000-0000-4000-8000-000000000041'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000041'

const body = {
  matchup_id: MATCHUP,
  home_team_id: TEAM_A,
  away_team_id: TEAM_B,
  action_id: ACTION,
  reason: 'swap the sides after the venue change',
}

describe('commishEditScheduleInputSchema — §15.4:1700 / 130:781', () => {
  it('LOWER-CASES every uuid (R768) and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishEditScheduleInputSchema.parse({ ...body, reason: '\t' })
    expect(parsed.matchup_id).toBe(MATCHUP_LC)
    expect(parsed.home_team_id).toBe(TEAM_A_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.reason).toBeUndefined()
    const without: Partial<typeof body> = { ...body }
    delete without.reason
    expect(commishEditScheduleInputSchema.safeParse(without).success).toBe(true)
  })

  it('home and away naming the SAME team is a field error on away_team_id (130:338, mirrored) — case-insensitively', () => {
    const same = commishEditScheduleInputSchema.safeParse({ ...body, away_team_id: TEAM_A_LC })
    expect(same.success).toBe(false)
    expect(same.success ? null : same.error.issues[0].path).toStrictEqual(['away_team_id'])
  })

  it('501-char reasons, a null reason, and unknown keys (a `week`, a `matchups[]`) are refused', () => {
    expect(commishEditScheduleInputSchema.safeParse({ ...body, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishEditScheduleInputSchema.safeParse({ ...body, reason: null }).success).toBe(false)
    expect(commishEditScheduleInputSchema.safeParse({ ...body, week: 3 }).success).toBe(false)
    expect(commishEditScheduleInputSchema.safeParse({ ...body, matchups: [] }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const result = {
  verb: 'commish_edit_schedule',
  action_id: ACTION_LC,
  matchup: {
    matchup_id: MATCHUP_LC,
    before: { home_team_id: TEAM_B, away_team_id: TEAM_A_LC },
    after: { home_team_id: TEAM_A_LC, away_team_id: TEAM_B },
  },
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000005',
  reason_required: false,
}

describe('commishEditSchedule — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_edit_schedule in 130:781’s order; the reason rides when given and is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishEditSchedule(client, LEAGUE, body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_edit_schedule', {
      p_league_id: LEAGUE,
      p_matchup_id: MATCHUP_LC,
      p_home: TEAM_A_LC,
      p_away: TEAM_B,
      p_reason: body.reason,
      p_action_id: ACTION_LC,
    })
    await commishEditSchedule(client, LEAGUE, { ...body, reason: '   ' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_reason')
  })

  it('never calls the manager-window verb — schedule_edit_matchup keeps every timing gate and is not this route’s door', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    await commishEditSchedule(client, LEAGUE, body)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_edit_schedule'])
  })

  it('returns 130’s document WHOLE — bypassed[], siblings and scoring are not narrowed away', async () => {
    const full = { ...result, bypassed: ['matchup_status_gate:live'], siblings: [{ id: 'x' }], scoring: { stored_cells_rewritten: 0 } }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishEditSchedule(client, LEAGUE, body)).body).toStrictEqual(full)
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each message VERBATIM', async () => {
    expect(await commishEditSchedule(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, body)).toStrictEqual({ status: 403, body: { error: COMMISH_SCHEDULE_FORBIDDEN_MESSAGE } })
    expect(await commishEditSchedule(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, body)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const bye = 'commish_edit_schedule: matchup df… is a bye row — v1 schedules have none to edit'
    expect(await commishEditSchedule(rpcDouble({ data: null, error: { code: 'P0001', message: bye } }).client, LEAGUE, body)).toStrictEqual({ status: 409, body: { error: bye } })
    const bound = 'commish_edit_schedule: the reason is 501 characters — at most 500 (the league_chat bound; §12.13)'
    expect(await commishEditSchedule(rpcDouble({ data: null, error: { code: '22023', message: bound } }).client, LEAGUE, body)).toStrictEqual({ status: 400, body: { error: bound } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT matchup / home / away / verb / id is a 409, never a 200 for an edit nobody made', async () => {
    for (const wrong of [
      { ...result, matchup: { ...result.matchup, matchup_id: 'df000000-0000-4000-8000-0000000000ff' } },
      { ...result, matchup: { ...result.matchup, after: { home_team_id: TEAM_C, away_team_id: TEAM_B } } },
      { ...result, matchup: { ...result.matchup, after: { home_team_id: TEAM_A_LC, away_team_id: TEAM_C } } },
      { ...result, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...result, verb: 'schedule_edit_matchup' },
      {}, // an empty document is not this submit either
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishEditSchedule(client, LEAGUE, body)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE })
    }
  })
})
