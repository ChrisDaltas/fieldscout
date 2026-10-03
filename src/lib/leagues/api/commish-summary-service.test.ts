/**
 * commish-summary-service.test.ts — the console's "needs you" read at the
 * service layer over an injected client double (M6 L.E1.32; spec §10.1 /
 * §16.2; PROGRESS D443, D446, D447, D455):
 *
 *   - THE GATE: a non-member (and a nonexistent league) gets the family's
 *     one no-leak 403 and nothing else is read; a MEMBER WHO IS NOT A
 *     COMMISSIONER gets this read's own 403 and no section is read; a member
 *     whose league was soft-deleted gets the 404 by name;
 *   - AN EMPTY LEAGUE: every section `ok` and empty, each emptiness with its
 *     reason in the document (`weeks: []`, `review_mode`);
 *   - THE PRE-PUSH SHAPE OF EACH SECTION (D447): the exact missing-object
 *     answer for the section's own object ⇒ `{ state: 'unavailable', missing,
 *     message }` while the other sections still answer — never a 500, never
 *     an empty list; any OTHER error ⇒ the whole read's 500 by name;
 *   - each section's rule: D339's no-manager predicate (managed / retired /
 *     autopilot-on / no member row), trades in review only under the
 *     commissioner mode, matchups split by the lock door's own answer with
 *     its sentence carried verbatim.
 *
 * `readTrades` is mocked here (its own suites prove it); the stack suite
 * (`commish-summary-api-db.test.ts`) drives the whole read for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readTrades = vi.fn()
vi.mock('./trades-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trades-service')>()
  return { ...actual, readTrades: (...args: unknown[]) => readTrades(...args) }
})

import {
  COMMISH_SUMMARY_FORBIDDEN_MESSAGE,
  MATCHUP_CORRECTIONS_UNAVAILABLE_MESSAGE,
  UNMANAGED_TEAMS_UNAVAILABLE_MESSAGE,
  readCommishSummary,
  type CommishSummary,
} from './commish-summary-service'
import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import { TRADE_SCHEMA_OBJECTS, TRADES_UNAVAILABLE_MESSAGE, type TradeView } from './trades-service'

const LEAGUE = 'c3200000-0000-4000-8000-000000000001'
const USER = 'c3200000-0000-4000-8000-0000000000aa'
const NOW = new Date('2099-10-04T20:00:00.000Z')
const T = (n: number) => `c3200000-0000-4000-8000-00000000010${n}`
const M = (n: number) => `c3200000-0000-4000-8000-00000000020${n}`

interface Answer {
  data: unknown
  error: { code?: string; message: string; hint?: string | null } | null
}
const ok = (data: unknown): Answer => ({ data, error: null })
const missingTable = (name: string): Answer => ({
  data: null,
  error: { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache`, hint: null },
})

interface Opts {
  member?: boolean
  commish?: boolean
  deleted?: boolean
  league?: { season: number; status: string }
  tables?: Partial<Record<string, Answer>>
  lock?: (matchupId: string) => Answer
}

/** A client double: `rpc` answers the two gates and the lock door; `from`
 *  answers each table with its configured `{data, error}` whatever the
 *  filter chain (the chain is recorded per table). */
function clientDouble(opts: Opts = {}) {
  const reads: string[] = []
  const chains: Record<string, Array<[string, unknown[]]>> = {}
  const league = opts.league ?? { season: 2099, status: 'in_season' }
  const tables: Record<string, Answer> = {
    teams: ok([]),
    league_members: ok([]),
    team_autopilot: ok([]),
    league_weeks: ok([]),
    matchups: ok([]),
    ...opts.tables,
  } as Record<string, Answer>
  const builder = (table: string) => {
    reads.push(table)
    chains[table] ??= []
    const answer = (): Answer =>
      table === 'leagues' ? ok(opts.deleted ? null : { id: LEAGUE, ...league }) : (tables[table] ?? ok([]))
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (v: Answer) => void) => resolve(answer())
          if (prop === 'maybeSingle') return async () => answer()
          return (...args: unknown[]) => {
            chains[table].push([prop, args])
            return chain
          }
        },
      },
    )
    return chain
  }
  const rpc = vi.fn(async (fn: string, args: Record<string, string>) => {
    if (fn === 'is_league_member') return ok(opts.member ?? true)
    if (fn === 'is_league_commish') return ok(opts.commish ?? true)
    if (fn === 'commish_matchup_edit_lock') {
      if (!opts.lock) throw new Error('unexpected lock call')
      return opts.lock(args.p_matchup_id)
    }
    throw new Error(`unexpected rpc ${fn}`)
  })
  return { client: { rpc, from: builder } as never, rpc, reads, chains }
}

const tradesDoc = (review: string, trades: Array<Partial<TradeView> & { id: string; status: TradeView['status'] }>) => ({
  status: 200,
  body: { settings: { trade_review: review }, trades },
})

beforeEach(() => {
  vi.clearAllMocks()
  readTrades.mockResolvedValue(tradesDoc('commissioner', []))
})

function summaryOf(res: { status: number; body: unknown }): CommishSummary {
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as CommishSummary
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('readCommishSummary — the gate (commissioners only)', () => {
  it('a NON-MEMBER gets the family’s one no-leak 403 (the answer a nonexistent league gives) and nothing is read', async () => {
    const { client, rpc, reads } = clientDouble({ member: false })
    const res = await readCommishSummary(client, LEAGUE, USER, NOW)
    expect(res).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(reads).toStrictEqual([])
    expect(readTrades).not.toHaveBeenCalled()
  })

  it('a MANAGER (a member, not a commissioner) gets this read’s own 403 and no section is read', async () => {
    const { client, rpc, reads } = clientDouble({ commish: false })
    const res = await readCommishSummary(client, LEAGUE, USER, NOW)
    expect(res).toStrictEqual({ status: 403, body: { error: COMMISH_SUMMARY_FORBIDDEN_MESSAGE } })
    expect(rpc.mock.calls.map(([fn]) => fn)).toStrictEqual(['is_league_member', 'is_league_commish'])
    expect(reads).toStrictEqual(['leagues']) // the membership gate's soft-delete check only
    expect(readTrades).not.toHaveBeenCalled()
  })

  it('a member whose league was soft-deleted gets the 404 by name (R812), before the commissioner check', async () => {
    const { client, rpc } = clientDouble({ deleted: true })
    const res = await readCommishSummary(client, LEAGUE, USER, NOW)
    expect(res).toStrictEqual({ status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } })
    expect(rpc.mock.calls.map(([fn]) => fn)).toStrictEqual(['is_league_member'])
  })
})

// ---------------------------------------------------------------------------
// An empty league
// ---------------------------------------------------------------------------

describe('readCommishSummary — an empty league', () => {
  it('pre-draft, one managed team, no weeks, no trades: every section ok and empty, the reason for each emptiness in the document', async () => {
    const { client, rpc } = clientDouble({
      league: { season: 2099, status: 'setup' },
      tables: {
        teams: ok([{ id: T(1), name: 'Commish Team', status: 'active' }]),
        league_members: ok([{ team_id: T(1), user_id: USER }]),
      },
    })
    const summary = summaryOf(await readCommishSummary(client, LEAGUE, USER, NOW))
    expect(summary).toStrictEqual({
      league_id: LEAGUE,
      season: 2099,
      league_status: 'setup',
      evaluated_at: NOW.toISOString(),
      sections: {
        unmanaged_teams: { state: 'ok', teams: [], no_seat_row: [] },
        trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [] },
        matchup_corrections: { state: 'ok', weeks: [], can_correct_now: [], not_yet: [] },
      },
    })
    // No week in play ⇒ the lock door is never asked.
    expect(rpc.mock.calls.map(([fn]) => fn)).not.toContain('commish_matchup_edit_lock')
    // The trades read is the existing one, open trades, at the caller's now.
    expect(readTrades).toHaveBeenCalledWith(client, LEAGUE, USER, { status: 'open' }, NOW)
  })

  it('the response carries exactly the three ruled sections — no lineup-report (Q83) and no week-final-corrections (Q81) placeholder', async () => {
    const { client } = clientDouble()
    const summary = summaryOf(await readCommishSummary(client, LEAGUE, USER, NOW))
    expect(Object.keys(summary.sections).sort()).toStrictEqual(['matchup_corrections', 'trades_awaiting_review', 'unmanaged_teams'])
  })
})

// ---------------------------------------------------------------------------
// Section 1 — teams with no manager and autopilot off
// ---------------------------------------------------------------------------

describe('unmanaged_teams — D339’s predicate with 139’s switch', () => {
  it('lists a seat with a member row and no manager and autopilot OFF (no row, or a stored false); skips a managed seat, an autopilot-ON seat; REPORTS a team with no member row', async () => {
    const { client } = clientDouble({
      tables: {
        teams: ok([
          { id: T(1), name: 'Managed', status: 'active' },
          { id: T(2), name: 'Placeholder', status: 'active' },
          { id: T(3), name: 'Orphaned, switch stored off', status: 'orphaned' },
          { id: T(4), name: 'Orphaned, on autopilot', status: 'orphaned' },
          { id: T(6), name: 'No member row', status: 'active' },
        ]),
        league_members: ok([
          { team_id: T(1), user_id: USER },
          { team_id: T(2), user_id: null },
          { team_id: T(3), user_id: null },
          { team_id: T(4), user_id: null },
          { team_id: null, user_id: 'c3200000-0000-4000-8000-0000000000bb' }, // a co-commissioner with no team
        ]),
        team_autopilot: ok([
          { team_id: T(3), is_on: false },
          { team_id: T(4), is_on: true },
          { team_id: T(1), is_on: true }, // ON but managed: arm (c) never runs for him
        ]),
      },
    })
    const { unmanaged_teams } = summaryOf(await readCommishSummary(client, LEAGUE, USER, NOW)).sections
    expect(unmanaged_teams).toStrictEqual({
      state: 'ok',
      teams: [
        { team_id: T(2), name: 'Placeholder', status: 'active' },
        { team_id: T(3), name: 'Orphaned, switch stored off', status: 'orphaned' },
      ],
      no_seat_row: [{ team_id: T(6), name: 'No member row' }],
    })
  })

  it('PRE-PUSH: no `team_autopilot` (PGRST205, anchored on its name) ⇒ the section is unavailable by name; the other sections still answer', async () => {
    const { client } = clientDouble({ tables: { team_autopilot: missingTable('team_autopilot') } })
    const summary = summaryOf(await readCommishSummary(client, LEAGUE, USER, NOW))
    expect(summary.sections.unmanaged_teams).toStrictEqual({
      state: 'unavailable',
      missing: ['team_autopilot'],
      message: UNMANAGED_TEAMS_UNAVAILABLE_MESSAGE,
    })
    expect(summary.sections.trades_awaiting_review.state).toBe('ok')
    expect(summary.sections.matchup_corrections.state).toBe('ok')
  })

  it('R1361: with the switch table absent AND the teams / members read failing, the failure is loud (500 by name) — "unavailable" never masks it', async () => {
    for (const [table, what] of [['teams', 'teams'], ['league_members', 'league_members']] as const) {
      const res = await readCommishSummary(
        clientDouble({ tables: { team_autopilot: missingTable('team_autopilot'), [table]: { data: null, error: { message: 'boom' } } } }).client,
        LEAGUE,
        USER,
        NOW,
      )
      expect(res, table).toStrictEqual({ status: 500, body: { error: `${what}: boom` } })
    }
  })

  it('a missing table that is NOT this section’s object, or any other error, is the whole read’s 500 by name — never a quietly missing section', async () => {
    const other = await readCommishSummary(clientDouble({ tables: { team_autopilot: missingTable('team_autopilotz') } }).client, LEAGUE, USER, NOW)
    expect(other.status).toBe(500)
    expect(JSON.stringify(other.body)).toContain('team_autopilot:')
    const boom = await readCommishSummary(clientDouble({ tables: { league_members: { data: null, error: { message: 'permission denied' } } } }).client, LEAGUE, USER, NOW)
    expect(boom).toStrictEqual({ status: 500, body: { error: 'league_members: permission denied' } })
  })
})

// ---------------------------------------------------------------------------
// Section 2 — trades waiting on the commissioner's review
// ---------------------------------------------------------------------------

describe('trades_awaiting_review — the open-trades read, in review under the commissioner mode', () => {
  const inReview = { id: 'tr-1', status: 'in_review' as const, review: { mode: 'commissioner', ends_at: '2099-10-05T20:00:00Z', ms_remaining: 86_400_000 } }
  const offer = { id: 'tr-2', status: 'proposed' as const }
  const waiting = { id: 'tr-3', status: 'accepted' as const }

  it('commissioner mode: only the trades IN REVIEW, each the trade read’s own view (review end and countdown included)', async () => {
    readTrades.mockResolvedValueOnce(tradesDoc('commissioner', [inReview, offer, waiting]))
    const { trades_awaiting_review } = summaryOf(await readCommishSummary(clientDouble().client, LEAGUE, USER, NOW)).sections
    expect(trades_awaiting_review).toStrictEqual({ state: 'ok', review_mode: 'commissioner', trades: [inReview] })
  })

  it('league vote / no review: nothing waits on the commissioner — an empty list with the mode that says why', async () => {
    for (const mode of ['league_vote', 'none']) {
      readTrades.mockResolvedValueOnce(tradesDoc(mode, [inReview]))
      const { trades_awaiting_review } = summaryOf(await readCommishSummary(clientDouble().client, LEAGUE, USER, NOW)).sections
      expect(trades_awaiting_review, mode).toStrictEqual({ state: 'ok', review_mode: mode, trades: [] })
    }
  })

  it('PRE-PUSH: the trade read’s named 503 (no trade objects) ⇒ the section is unavailable by name; the other sections still answer', async () => {
    readTrades.mockResolvedValueOnce({ status: 503, body: { error: TRADES_UNAVAILABLE_MESSAGE } })
    const summary = summaryOf(await readCommishSummary(clientDouble().client, LEAGUE, USER, NOW))
    expect(summary.sections.trades_awaiting_review).toStrictEqual({ state: 'unavailable', missing: [...TRADE_SCHEMA_OBJECTS], message: TRADES_UNAVAILABLE_MESSAGE })
    expect(summary.sections.unmanaged_teams.state).toBe('ok')
  })

  it('R1362: a 503 that is NOT the trade read’s named "no trade objects" answer is the whole read’s 500, never "unavailable"', async () => {
    readTrades.mockResolvedValueOnce({ status: 503, body: { error: 'some other service is down' } })
    expect(await readCommishSummary(clientDouble().client, LEAGUE, USER, NOW)).toStrictEqual({ status: 500, body: { error: 'trades: some other service is down' } })
  })

  it('any other failure of the trade read is the whole read’s 500, naming it', async () => {
    readTrades.mockResolvedValueOnce({ status: 500, body: { error: 'trades: relation exploded' } })
    expect(await readCommishSummary(clientDouble().client, LEAGUE, USER, NOW)).toStrictEqual({ status: 500, body: { error: 'trades: trades: relation exploded' } })
  })
})

// ---------------------------------------------------------------------------
// Section 3 — matchups whose score can be corrected now vs not yet
// ---------------------------------------------------------------------------

describe('matchup_corrections — the Q61 / Q67 lock door per matchup of the weeks in play', () => {
  const teams = ok([
    { id: T(1), name: 'Alpha', status: 'active' },
    { id: T(2), name: 'Bravo', status: 'active' },
    { id: T(3), name: 'Charlie', status: 'active' },
    { id: T(4), name: 'Delta', status: 'active' },
  ])
  const weeks = ok([
    { week: 4, status: 'correction_window' },
    { week: 5, status: 'live' },
  ])
  const matchups = ok([
    { id: M(1), week: 4, round_type: 'regular', home_team_id: T(1), away_team_id: T(2) },
    { id: M(2), week: 5, round_type: 'regular', home_team_id: T(3), away_team_id: T(4) },
    { id: M(3), week: 5, round_type: 'regular', home_team_id: T(1), away_team_id: null },
  ])
  const NOT_YET = 'This matchup can be corrected once every starter’s game has finished — not finished yet: Some Guy (KC)'
  const lock = (matchupId: string): Answer => {
    if (matchupId === M(1)) return ok({ matchup_id: M(1), editable: true, why: 'week_games_over', message: null })
    if (matchupId === M(2)) return ok({ matchup_id: M(2), editable: false, why: 'starters_not_finished', message: NOT_YET })
    return ok({ matchup_id: M(3), editable: false, why: 'lineup_not_set', message: 'no lineup set yet: Alpha' })
  }

  it('asks the door for every matchup of the live / correction-window weeks and splits on ITS answer, the refusal sentence carried verbatim', async () => {
    const { client, rpc, chains } = clientDouble({ tables: { teams, league_weeks: weeks, matchups }, lock })
    const { matchup_corrections } = summaryOf(await readCommishSummary(client, LEAGUE, USER, NOW)).sections
    expect(matchup_corrections).toStrictEqual({
      state: 'ok',
      weeks: [4, 5],
      can_correct_now: [
        { matchup_id: M(1), week: 4, round_type: 'regular', home: { team_id: T(1), name: 'Alpha' }, away: { team_id: T(2), name: 'Bravo' }, why: 'week_games_over', message: null },
      ],
      not_yet: [
        { matchup_id: M(2), week: 5, round_type: 'regular', home: { team_id: T(3), name: 'Charlie' }, away: { team_id: T(4), name: 'Delta' }, why: 'starters_not_finished', message: NOT_YET },
        { matchup_id: M(3), week: 5, round_type: 'regular', home: { team_id: T(1), name: 'Alpha' }, away: null, why: 'lineup_not_set', message: 'no lineup set yet: Alpha' },
      ],
    })
    expect(rpc.mock.calls.filter(([fn]) => fn === 'commish_matchup_edit_lock').map(([, a]) => a)).toStrictEqual(
      [M(1), M(2), M(3)].map((id) => ({ p_league_id: LEAGUE, p_matchup_id: id })),
    )
    // Only the weeks being played or corrected — never a final or upcoming one.
    expect(chains.league_weeks).toContainEqual(['in', ['status', ['live', 'correction_window']]])
    expect(chains.league_weeks).toContainEqual(['eq', ['season', 2099]])
    expect(chains.matchups).toContainEqual(['in', ['week', [4, 5]]])
  })

  it('PRE-PUSH: no lock door (PGRST202 naming only its own arguments) ⇒ the section is unavailable by name; the others still answer', async () => {
    const absent = (): Answer => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.commish_matchup_edit_lock(p_league_id, p_matchup_id) in the schema cache', hint: null },
    })
    const summary = summaryOf(await readCommishSummary(clientDouble({ tables: { teams, league_weeks: weeks, matchups }, lock: absent }).client, LEAGUE, USER, NOW))
    expect(summary.sections.matchup_corrections).toStrictEqual({
      state: 'unavailable',
      missing: ['commish_matchup_edit_lock'],
      message: MATCHUP_CORRECTIONS_UNAVAILABLE_MESSAGE,
    })
    expect(summary.sections.unmanaged_teams.state).toBe('ok')
    expect(summary.sections.trades_awaiting_review.state).toBe('ok')
  })

  it('a door that EXISTS under another signature (argument drift), a refusal, or an answer without a boolean for THIS matchup is the whole read’s 500 — never "correctable", never "unavailable"', async () => {
    const drift = (): Answer => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.commish_matchup_edit_lock(p_league_id, p_matchup_id) in the schema cache',
        hint: 'Perhaps you meant to call the function public.commish_matchup_edit_lock(p_matchup_id, p_league_id, p_at)',
      },
    })
    const refused = (): Answer => ({ data: null, error: { code: '42501', message: 'not a commissioner' } })
    const foreign = (): Answer => ok({ matchup_id: M(9), editable: true, why: 'week_final', message: null })
    const noBool = (id: string): Answer => ok({ matchup_id: id, editable: 'yes', why: 'week_final', message: null })
    for (const lockFn of [drift, refused, foreign, noBool]) {
      const res = await readCommishSummary(clientDouble({ tables: { teams, league_weeks: weeks, matchups }, lock: lockFn }).client, LEAGUE, USER, NOW)
      expect(res.status, lockFn.name).toBe(500)
      expect(JSON.stringify(res.body), lockFn.name).toContain('commish_matchup_edit_lock')
    }
  })

  it('a matchup side that is not a team of this league is a named 500, never a nameless row', async () => {
    const stranger = ok([{ id: M(1), week: 4, round_type: 'regular', home_team_id: T(1), away_team_id: T(9) }])
    const res = await readCommishSummary(clientDouble({ tables: { teams, league_weeks: weeks, matchups: stranger }, lock }).client, LEAGUE, USER, NOW)
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).toContain(T(9))
  })
})
