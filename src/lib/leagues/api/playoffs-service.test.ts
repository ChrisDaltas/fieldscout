/**
 * playoffs-service.test.ts — `readPlayoffBracket` over an INJECTED client
 * (the D68/D71 layering; the `standings-service.test.ts` shape): the
 * family mapper's arms by STATUS (never a SQLSTATE named here — the routes
 * pin), the F250(a) 404 copy, the no-document 500, and the F247(b) figure
 * discipline with E61's NULL kept NULL. The real RPC is driven by
 * `inseason-reads-api-db.test.ts` (the stack lane).
 */
import { describe, expect, it } from 'vitest'

import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import { normalizeBracketGame, nullableFigure, readPlayoffBracket } from './playoffs-service'

type Rpc = (name: string, args: unknown) => Promise<{ data: unknown; error: { code: string; message: string } | null }>

function clientWith(rpc: Rpc) {
  return { rpc } as unknown as Parameters<typeof readPlayoffBracket>[0]
}

const LEAGUE = '00000000-0000-4000-8000-000000000001'

const game = {
  home_team_id: 'h',
  home_seed: 3,
  away_team_id: 'a',
  away_seed: 6,
  weeks: [{ week: 15, matchup_id: 'm1', home_score: '101.25', away_score: null, status: 'live', result: null, is_overridden: false }],
  home_total: '101.25',
  away_total: 0,
  winner_team_id: 'h',
  decided_by: 'points',
  final: false,
}

describe('readPlayoffBracket — the family mapper by status', () => {
  it('calls 118’s member read with the league id and passes a no-bracket document through whole', async () => {
    const calls: unknown[] = []
    const doc = { league_id: LEAGUE, kind: 'points_race', view: 'points_race', status: 'in_season', rollover_at: null }
    const result = await readPlayoffBracket(
      clientWith(async (name, args) => {
        calls.push([name, args])
        return { data: doc, error: null }
      }),
      LEAGUE,
    )
    expect(calls).toEqual([['league_playoff_bracket', { p_league_id: LEAGUE }]])
    expect(result).toStrictEqual({ status: 200, body: doc })
  })

  it('42501 (a non-member, refused in-body) is the family’s 403 with the no-leak copy', async () => {
    const result = await readPlayoffBracket(
      clientWith(async () => ({ data: null, error: { code: '42501', message: 'league_playoff_bracket: only a member of the league may read its bracket' } })),
      LEAGUE,
    )
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('P0002 (a missing or soft-deleted league) is the ONE 404 copy (F250(a) / R812), never the RPC’s own words', async () => {
    const result = await readPlayoffBracket(
      clientWith(async () => ({ data: null, error: { code: 'P0002', message: 'playoff_bracket_state_internal: league x not found' } })),
      LEAGUE,
    )
    expect(result).toStrictEqual({ status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } })
  })

  it('a defective plan (P0001 — 118 refuses by name) surfaces as the family’s 409 with the message verbatim; anything else a 500', async () => {
    const p0001 = await readPlayoffBracket(clientWith(async () => ({ data: null, error: { code: 'P0001', message: 'the plan (110) is defective' } })), LEAGUE)
    expect(p0001).toStrictEqual({ status: 409, body: { error: 'the plan (110) is defective' } })
    const other = await readPlayoffBracket(clientWith(async () => ({ data: null, error: { code: '08006', message: 'boom' } })), LEAGUE)
    expect(other.status).toBe(500)
  })

  it('no document / no kind / a bracket without a round_list is a 500 BY NAME — never an empty bracket (CLAUDE.md)', async () => {
    for (const data of [null, {}, { kind: 'bracket' }, { kind: 'bracket', view: 'bracket' }]) {
      const result = await readPlayoffBracket(clientWith(async () => ({ data, error: null })), LEAGUE)
      expect(result.status, JSON.stringify(data)).toBe(500)
      expect(String((result.body as { error: string }).error)).toMatch(/league_playoff_bracket/)
    }
  })

  it('a bracket document’s score figures are coerced (F247(b)) and a NULL score stays NULL (E61)', async () => {
    const doc = { league_id: LEAGUE, kind: 'bracket', view: 'bracket', round_list: [{ round: 1, built: true, games: [game] }] }
    const result = await readPlayoffBracket(clientWith(async () => ({ data: doc, error: null })), LEAGUE)
    expect(result.status).toBe(200)
    const body = result.body as unknown as { round_list: Array<{ games: Array<{ home_total: number; away_total: number; weeks: Array<{ home_score: number | null; away_score: number | null }> }> }> }
    const g = body.round_list[0].games[0]
    expect(g.home_total).toBe(101.25)
    expect(g.away_total).toBe(0)
    expect(g.weeks[0].home_score).toBe(101.25)
    expect(g.weeks[0].away_score).toBeNull()
  })

  it('a figure that is neither a number, a decimal string nor NULL refuses the document (a 500 by name)', async () => {
    const doc = { league_id: LEAGUE, kind: 'bracket', view: 'bracket', round_list: [{ round: 1, built: true, games: [{ ...game, home_total: '1e3' }] }] }
    const result = await readPlayoffBracket(clientWith(async () => ({ data: doc, error: null })), LEAGUE)
    expect(result).toStrictEqual({ status: 500, body: { error: 'league_playoff_bracket: home_total for seed 3 is not a finite number ("1e3") — F247(b)' } })
  })
})

describe('the figure discipline', () => {
  it('nullableFigure: number / decimal string / NULL pass; the R811 strings refuse', () => {
    expect(nullableFigure(12.5)).toBe(12.5)
    expect(nullableFigure('12.50')).toBe(12.5)
    expect(nullableFigure(null)).toBeNull()
    expect(nullableFigure(undefined)).toBeNull()
    for (const bad of ['', ' 5 ', '0x10', '1e3', 'NaN', true, {}]) {
      expect(Number.isNaN(nullableFigure(bad) as number), JSON.stringify(bad)).toBe(true)
    }
  })

  it('normalizeBracketGame refuses a NULL total (a total is a sum 118 always writes) and a NaN week score', () => {
    expect(() => normalizeBracketGame({ ...game, home_total: null })).toThrow(/home_total for seed 3 is not a finite number/)
    expect(() => normalizeBracketGame({ ...game, weeks: [{ ...game.weeks[0], away_score: 'x' }] })).toThrow(/away_score on matchup m1 is not a finite number/)
  })
})
