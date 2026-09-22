/**
 * commish-bracket-service.test.ts — the PURE half of the commissioner
 * bracket hand-pick (M6A task L.E1.16; spec §11.5; migration 134; PROGRESS
 * F360 / D351). The family's three proofs, for this verb:
 *
 *   - the SCHEMA accepts an absent / blank reason (Q66), LOWER-CASES every
 *     uuid (R768), takes `away_team_id: null` as a BYE and refuses an ABSENT
 *     away (strict — a bye is said, never implied); home === away is a field
 *     error;
 *   - 134's argument order, an absent reason OMITTED, a bye sent as
 *     `p_away: null`;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard — a
 *     reused `action_id` for a different matchup / pairing / verb is a 409,
 *     and a bye compares as null on BOTH sides.
 *
 * The live half (the permutation, the seeds, the stand-down, the receipt)
 * is pgTAP 082 + the stack suite.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE,
  COMMISH_BRACKET_FORBIDDEN_MESSAGE,
  commishEditBracket,
  commishEditBracketInputSchema,
} from './commish-bracket-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const MATCHUP = 'DF000000-0000-4000-8000-000000000071'
const MATCHUP_LC = 'df000000-0000-4000-8000-000000000071'
const TEAM_E = 'CE000000-0000-4000-8000-000000000005'
const TEAM_E_LC = 'ce000000-0000-4000-8000-000000000005'
const TEAM_F = 'ce000000-0000-4000-8000-000000000006'
const TEAM_G = 'ce000000-0000-4000-8000-000000000007'
const ACTION = 'AFA00000-0000-4000-8000-000000000061'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000061'

const body = {
  matchup_id: MATCHUP,
  home_team_id: TEAM_E,
  away_team_id: TEAM_F,
  action_id: ACTION,
  reason: 'the 3 seed asked for the earlier slot',
}

describe('commishEditBracketInputSchema — §11.5 / 134', () => {
  it('LOWER-CASES every uuid (R768) and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishEditBracketInputSchema.parse({ ...body, reason: '\t' })
    expect(parsed.matchup_id).toBe(MATCHUP_LC)
    expect(parsed.home_team_id).toBe(TEAM_E_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.reason).toBeUndefined()
    const without: Partial<typeof body> = { ...body }
    delete without.reason
    expect(commishEditBracketInputSchema.safeParse(without).success).toBe(true)
  })

  it('a BYE is `away_team_id: null` — said, never implied: an ABSENT away is refused (strict)', () => {
    expect(commishEditBracketInputSchema.parse({ ...body, away_team_id: null }).away_team_id).toBeNull()
    const absent: Partial<typeof body> = { ...body }
    delete absent.away_team_id
    expect(commishEditBracketInputSchema.safeParse(absent).success).toBe(false)
  })

  it('home and away naming the SAME team is a field error on away_team_id — case-insensitively', () => {
    const same = commishEditBracketInputSchema.safeParse({ ...body, away_team_id: TEAM_E_LC })
    expect(same.success).toBe(false)
    expect(same.success ? null : same.error.issues[0].path).toStrictEqual(['away_team_id'])
  })

  it('501-char reasons, a null reason, a null HOME, and unknown keys (a `round`, a `seeds`) are refused', () => {
    expect(commishEditBracketInputSchema.safeParse({ ...body, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishEditBracketInputSchema.safeParse({ ...body, reason: null }).success).toBe(false)
    expect(commishEditBracketInputSchema.safeParse({ ...body, home_team_id: null }).success).toBe(false)
    expect(commishEditBracketInputSchema.safeParse({ ...body, round: 1 }).success).toBe(false)
    expect(commishEditBracketInputSchema.safeParse({ ...body, seeds: {} }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const result = {
  verb: 'commish_edit_bracket',
  action_id: ACTION_LC,
  matchup: {
    matchup_id: MATCHUP_LC,
    before: { home_team_id: TEAM_E_LC, away_team_id: TEAM_G, home_seed: 3, away_seed: 6 },
    after: { home_team_id: TEAM_E_LC, away_team_id: TEAM_F, home_seed: 3, away_seed: 5 },
  },
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000005',
  reason_required: false,
}

describe('commishEditBracket — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_edit_bracket in 134’s order; the reason rides when given and is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishEditBracket(client, LEAGUE, body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_edit_bracket', {
      p_league_id: LEAGUE,
      p_matchup_id: MATCHUP_LC,
      p_home: TEAM_E_LC,
      p_away: TEAM_F,
      p_reason: body.reason,
      p_action_id: ACTION_LC,
    })
    await commishEditBracket(client, LEAGUE, { ...body, reason: '   ' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_reason')
  })

  it('a BYE is sent as `p_away: null` (present, null — the RPC has no default to fall back on), and the guard accepts null on both sides', async () => {
    const byeDoc = { ...result, matchup: { ...result.matchup, after: { home_team_id: TEAM_E_LC, away_team_id: null, home_seed: 3, away_seed: null } } }
    const { client, rpc } = rpcDouble({ data: byeDoc, error: null })
    const res = await commishEditBracket(client, LEAGUE, { ...body, away_team_id: null })
    expect(res.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_away', null)
  })

  it('never calls the regular-season verbs — commish_edit_schedule / schedule_edit_matchup are not this door', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    await commishEditBracket(client, LEAGUE, body)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_edit_bracket'])
  })

  it('returns 134’s document WHOLE — bypassed[], siblings, entrants and rows_marked are not narrowed away', async () => {
    const full = { ...result, bypassed: ['bracket_sync_rebuild:stood_down'], siblings: [{ home_before: 'x' }], entrants: [TEAM_E_LC], rows_marked: 4 }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishEditBracket(client, LEAGUE, body)).body).toStrictEqual(full)
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 · 400, each message VERBATIM', async () => {
    expect(await commishEditBracket(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, body)).toStrictEqual({ status: 403, body: { error: COMMISH_BRACKET_FORBIDDEN_MESSAGE } })
    expect(await commishEditBracket(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, body)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const stranger = 'commish_edit_bracket: team ce… is not in round 1 of league b4… — the round’s entrants are the 6 teams seeded on its rows'
    expect(await commishEditBracket(rpcDouble({ data: null, error: { code: 'P0001', message: stranger } }).client, LEAGUE, body)).toStrictEqual({ status: 409, body: { error: stranger } })
    const bound = 'commish_edit_bracket: the reason is 501 characters — at most 500 (the league_chat bound; §12.13)'
    expect(await commishEditBracket(rpcDouble({ data: null, error: { code: '22023', message: bound } }).client, LEAGUE, body)).toStrictEqual({ status: 400, body: { error: bound } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT matchup / home / away / verb / id is a 409, never a 200 for an edit nobody made — and a bye is not "any away"', async () => {
    for (const wrong of [
      { ...result, matchup: { ...result.matchup, matchup_id: 'df000000-0000-4000-8000-0000000000ff' } },
      { ...result, matchup: { ...result.matchup, after: { ...result.matchup.after, home_team_id: TEAM_G } } },
      { ...result, matchup: { ...result.matchup, after: { ...result.matchup.after, away_team_id: TEAM_G } } },
      { ...result, matchup: { ...result.matchup, after: { ...result.matchup.after, away_team_id: null } } }, // a bye document for a two-team submit
      { ...result, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...result, verb: 'commish_edit_schedule' },
      {}, // an empty document is not this submit either
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishEditBracket(client, LEAGUE, body)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE })
    }
    // …and the mirror: a two-team document for a BYE submit.
    const { client } = rpcDouble({ data: result, error: null })
    expect((await commishEditBracket(client, LEAGUE, { ...body, away_team_id: null })).status).toBe(409)
  })
})
