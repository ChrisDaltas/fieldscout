/**
 * commish-matchup-service.test.ts — the PURE half of the commissioner
 * matchup override (M6A task L.E1.10; spec §15.4:1692-1693; migration 126;
 * PROGRESS D351).
 *
 * What this suite proves that the lineup template's cannot: **THE REASON IS
 * OPTIONAL AT THE FIELD LEVEL** (Q66 — Chris, 2026-09-16; spec v2.16.41).
 * An absent, blank or tab-only reason PASSES the schema (normalised to
 * absent, never `''`), while a 501-char or non-string one is still a field
 * error. This suite proves the SCHEMA only — end-to-end (since migration
 * 131 / L.E1.15, F362) a no-reason request lands with a NULL-reason receipt,
 * and the stack suite pins that.
 *
 * The rest is D351's contract: §15.4's argument order on the wire, the
 * family mapper's four arms with the message VERBATIM, and the F65(b)
 * identity guard per verb — a reused `action_id` naming a different matchup,
 * a different verb, different numbers or a different winner is a 409, never
 * the ORIGINAL document as a 200 reporting a change nobody made.
 *
 * The live half (the auth matrix, the arms, the FINAL-week rebuild, replay)
 * is pgTAP 074 against the real function.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE,
  COMMISH_MATCHUP_FORBIDDEN_MESSAGE,
  commishEditScore,
  commishEditScoreInputSchema,
  commishSetResult,
  commishSetResultInputSchema,
  optionalReason,
} from './commish-matchup-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const MATCHUP = 'DA000000-0000-4000-8000-000000000001'
const MATCHUP_LC = 'da000000-0000-4000-8000-000000000001'
const HOME = 'ce000000-0000-4000-8000-000000000001'
const AWAY = 'ce000000-0000-4000-8000-000000000002'
const ACTION = 'AFA00000-0000-4000-8000-000000000021'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000021'

const scoreBody = {
  matchup_id: MATCHUP,
  home_score: 98.4,
  away_score: 101.25,
  action_id: ACTION,
  reason: 'stat correction landed after finalization',
}
const resultBody = {
  matchup_id: MATCHUP,
  winner_team_id: AWAY,
  action_id: ACTION,
  reason: 'ineligible player started (bye)',
}

describe('optionalReason — Q66: a reason is optional on every commissioner action', () => {
  it('ACCEPTS an absent reason (the inverse of the pre-Q66 template, commish-lineup-service.ts:84)', () => {
    expect(optionalReason.safeParse(undefined)).toStrictEqual({ success: true, data: undefined })
  })

  it('ACCEPTS a blank / tab-only reason and normalises it to ABSENT — never to the empty string', () => {
    for (const reason of ['', '   ', '\t\t', '\n', ' \t\r\n ']) {
      const parsed = optionalReason.safeParse(reason)
      expect(parsed.success, JSON.stringify(reason)).toBe(true)
      expect(parsed.data, JSON.stringify(reason)).toBeUndefined()
    }
  })

  it('trims a real reason and keeps the 500 bound — 501 is still a field error, and so is a non-string', () => {
    expect(optionalReason.parse('  because  ')).toBe('because')
    expect(optionalReason.safeParse('x'.repeat(500)).success).toBe(true)
    expect(optionalReason.safeParse('x'.repeat(501)).success).toBe(false)
    expect(optionalReason.safeParse(null).success).toBe(false)
    expect(optionalReason.safeParse(42).success).toBe(false)
  })
})

describe('commishEditScoreInputSchema — §15.4:1692', () => {
  it('LOWER-CASES both uuids (R768 — the guard compares against what Postgres wrote) and keeps both numbers', () => {
    const parsed = commishEditScoreInputSchema.parse(scoreBody)
    expect(parsed.matchup_id).toBe(MATCHUP_LC)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.home_score).toBe(98.4)
    expect(parsed.away_score).toBe(101.25)
  })

  it('a MISSING or blank reason is accepted at the field level (Q66) — the body parses with reason absent', () => {
    const without: Partial<typeof scoreBody> = { ...scoreBody }
    delete without.reason
    expect(commishEditScoreInputSchema.parse(without).reason).toBeUndefined()
    expect(commishEditScoreInputSchema.parse({ ...scoreBody, reason: '\t\t' }).reason).toBeUndefined()
  })

  it('BOTH scores are required (D342 — is_overridden is one flag on the whole row), finite, and numbers', () => {
    const noAway: Partial<typeof scoreBody> = { ...scoreBody }
    delete noAway.away_score
    expect(commishEditScoreInputSchema.safeParse(noAway).success).toBe(false)
    expect(commishEditScoreInputSchema.safeParse({ ...scoreBody, home_score: '98.4' }).success).toBe(false)
    expect(commishEditScoreInputSchema.safeParse({ ...scoreBody, home_score: Number.NaN }).success).toBe(false)
    expect(commishEditScoreInputSchema.safeParse({ ...scoreBody, home_score: Number.POSITIVE_INFINITY }).success).toBe(false)
  })

  it('action_id is REQUIRED and unknown keys are refused (strictObject)', () => {
    const without: Partial<typeof scoreBody> = { ...scoreBody }
    delete without.action_id
    expect(commishEditScoreInputSchema.safeParse(without).success).toBe(false)
    expect(commishEditScoreInputSchema.safeParse({ ...scoreBody, winner_team_id: AWAY }).success).toBe(false)
  })
})

describe('commishSetResultInputSchema — §15.4:1693', () => {
  it('normalises every id and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishSetResultInputSchema.parse({ ...resultBody, reason: '   ' })
    expect(parsed.matchup_id).toBe(MATCHUP_LC)
    expect(parsed.winner_team_id).toBe(AWAY)
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.reason).toBeUndefined()
  })

  it('winner_team_id must be a uuid; a 501-char reason and a smuggled score are refused', () => {
    expect(commishSetResultInputSchema.safeParse({ ...resultBody, winner_team_id: 'home' }).success).toBe(false)
    expect(commishSetResultInputSchema.safeParse({ ...resultBody, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishSetResultInputSchema.safeParse({ ...resultBody, home_score: 1 }).success).toBe(false)
  })
})

/** A Supabase double whose only job is to record the RPC arguments. */
function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const scoreResult = {
  matchup_id: MATCHUP_LC,
  action_id: ACTION_LC,
  verb: 'commish_edit_score',
  home_team_id: HOME,
  away_team_id: AWAY,
  home_score: 98.4,
  away_score: 101.25,
  result: 'away',
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000001',
}
const resultResult = {
  matchup_id: MATCHUP_LC,
  action_id: ACTION_LC,
  verb: 'commish_set_result',
  home_team_id: HOME,
  away_team_id: AWAY,
  home_score: 98.4,
  away_score: 101.25,
  result: 'away',
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000002',
}

describe('commishEditScore — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_edit_score in §15.4:1692’s argument order with the reason when given', async () => {
    const { client, rpc } = rpcDouble({ data: scoreResult, error: null })
    const res = await commishEditScore(client, LEAGUE, scoreBody)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_edit_score', {
      p_league_id: LEAGUE,
      p_matchup_id: MATCHUP_LC,
      p_home: 98.4,
      p_away: 101.25,
      p_reason: scoreBody.reason,
      p_action_id: ACTION_LC,
    })
  })

  it('OMITS p_reason when the reason is absent or blank — the RPC’s DEFAULT NULL stands; nothing is sent as ""', async () => {
    const { client, rpc } = rpcDouble({ data: scoreResult, error: null })
    await commishEditScore(client, LEAGUE, { ...scoreBody, reason: ' \t ' })
    expect(rpc).toHaveBeenCalledWith('commish_edit_score', {
      p_league_id: LEAGUE,
      p_matchup_id: MATCHUP_LC,
      p_home: 98.4,
      p_away: 101.25,
      p_action_id: ACTION_LC,
    })
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_reason')
  })

  it('a bad body is a 400 with field errors and the RPC is never reached — but a blank reason is NOT a bad body', async () => {
    const { client, rpc } = rpcDouble({ data: scoreResult, error: null })
    const bad = await commishEditScore(client, LEAGUE, { ...scoreBody, matchup_id: 'nope' })
    expect(bad.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    const blank = await commishEditScore(client, LEAGUE, { ...scoreBody, reason: '' })
    expect(blank.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('returns 126’s document WHOLE — the override keys are not narrowed away', async () => {
    const full = { ...scoreResult, bypassed: ['week_status_gate:final'], standings_rebuilt: true, live_scoring_frozen: true }
    const { client } = rpcDouble({ data: full, error: null })
    const res = await commishEditScore(client, LEAGUE, scoreBody)
    expect(res.body).toStrictEqual(full)
  })

  it('the family mapper, imported not re-derived: 42501 → 403 with THIS route’s copy; P0002 → 404, P0001 → 409, 22023 → 400 each VERBATIM', async () => {
    const forbidden = await commishEditScore(rpcDouble({ data: null, error: { code: '42501', message: 'commish_edit_score: not a commissioner of this league' } }).client, LEAGUE, scoreBody)
    expect(forbidden).toStrictEqual({ status: 403, body: { error: COMMISH_MATCHUP_FORBIDDEN_MESSAGE } })

    const notFound = 'commish_edit_score: league b4… not found'
    expect(await commishEditScore(rpcDouble({ data: null, error: { code: 'P0002', message: notFound } }).client, LEAGUE, scoreBody)).toStrictEqual({ status: 404, body: { error: notFound } })

    const conflict = 'commish_edit_score: matchup da… is not a matchup of league b4…'
    expect(await commishEditScore(rpcDouble({ data: null, error: { code: 'P0001', message: conflict } }).client, LEAGUE, scoreBody)).toStrictEqual({ status: 409, body: { error: conflict } })

    // A 22023 with the pre-131 gate text (126 no longer raises it — L.E1.15 /
    // F362 — but the MAPPER is what is under test here): the service maps any
    // 22023 to a 400 with the text verbatim, no special case.
    const gate = 'commish_edit_score: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
    expect(await commishEditScore(rpcDouble({ data: null, error: { code: '22023', message: gate } }).client, LEAGUE, { ...scoreBody, reason: '' })).toStrictEqual({ status: 400, body: { error: gate } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT matchup / verb / number is a 409, never a 200 reporting a score nobody set', async () => {
    for (const wrong of [
      { ...scoreResult, matchup_id: 'da000000-0000-4000-8000-0000000000ff' },
      { ...scoreResult, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...scoreResult, verb: 'commish_set_result' }, // the sibling door’s document, same ledger
      { ...scoreResult, home_score: 99.4 },
      { ...scoreResult, away_score: 100 },
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishEditScore(client, LEAGUE, scoreBody)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE })
    }
  })

  it('F366 — the BYE arm: `away_score: null` is accepted, sent as `p_away: null` (present), and a bye document answers it 200; a two-team submit answered by a bye document (or the reverse) is a 409, never a 200 for a correction nobody made', async () => {
    const bye = { ...scoreResult, away_team_id: null, away_score: null }
    const { client, rpc } = rpcDouble({ data: bye, error: null })
    expect((await commishEditScore(client, LEAGUE, { ...scoreBody, away_score: null })).status).toBe(200)
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_away', null)
    expect((await commishEditScore(client, LEAGUE, scoreBody)).status).toBe(409)
    const { client: twoTeam } = rpcDouble({ data: scoreResult, error: null })
    expect((await commishEditScore(twoTeam, LEAGUE, { ...scoreBody, away_score: null })).status).toBe(409)
    // An ABSENT away is still refused: a bye is said, never implied.
    const absent: Partial<typeof scoreBody> = { ...scoreBody }
    delete absent.away_score
    expect(commishEditScoreInputSchema.safeParse(absent).success).toBe(false)
  })
})

describe('commishSetResult — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_set_result in §15.4:1693’s argument order; an absent reason is omitted', async () => {
    const { client, rpc } = rpcDouble({ data: resultResult, error: null })
    const res = await commishSetResult(client, LEAGUE, { ...resultBody, reason: undefined })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_set_result', {
      p_league_id: LEAGUE,
      p_matchup_id: MATCHUP_LC,
      p_winner: AWAY,
      p_action_id: ACTION_LC,
    })
  })

  it('never calls the score door or any manager verb', async () => {
    const { client, rpc } = rpcDouble({ data: resultResult, error: null })
    await commishSetResult(client, LEAGUE, resultBody)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_set_result'])
  })

  it('the family mapper: 42501 → 403 (this route’s copy), P0001 → 409 VERBATIM (F351’s tie text survives), 22023 → 400 VERBATIM', async () => {
    expect(await commishSetResult(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, resultBody)).toStrictEqual({ status: 403, body: { error: COMMISH_MATCHUP_FORBIDDEN_MESSAGE } })
    const tie = 'commish_set_result: team ce… is not a side of matchup da… (home …, away …). To record a TIE, use the score arm (commish_edit_score) with equal scores — a winner id cannot express one (§15.4:1693; F351)'
    expect(await commishSetResult(rpcDouble({ data: null, error: { code: 'P0001', message: tie } }).client, LEAGUE, resultBody)).toStrictEqual({ status: 409, body: { error: tie } })
    const gate = 'commish_set_result: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
    expect(await commishSetResult(rpcDouble({ data: null, error: { code: '22023', message: gate } }).client, LEAGUE, { ...resultBody, reason: '' })).toStrictEqual({ status: 400, body: { error: gate } })
    expect(await commishSetResult(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, resultBody)).toStrictEqual({ status: 404, body: { error: 'gone' } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT matchup / verb / winner is a 409', async () => {
    for (const wrong of [
      { ...resultResult, matchup_id: 'da000000-0000-4000-8000-0000000000ff' },
      { ...resultResult, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...resultResult, verb: 'commish_edit_score' }, // the sibling door’s document
      { ...resultResult, result: 'home' }, // the OTHER side won in the original submit
      { ...resultResult, result: 'tie' }, // no winner at all — a score-arm document
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishSetResult(client, LEAGUE, resultBody)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE })
    }
  })
})
