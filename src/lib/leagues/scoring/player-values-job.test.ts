/**
 * player-values-job — the run over a FAKE client (M6A L.E1.20; PROGRESS
 * D374). The stack suite (`player-values-db.test.ts`) proves the real write
 * path; this file reaches the arms the database itself will not let a
 * fixture construct (a NULL or invalid snapshot on an in-season league is
 * refused by 059 / 104's triggers) and pins every loud-failure arm by name:
 *
 *   J1 QUARANTINE — a NULL and a corrupt snapshot fail THEIR league by name;
 *      the sibling league is valued (the worker's D292 posture).
 *   J2 A SHORT UPSERT is a named failure, never "done".
 *   J3 NO USABLE PROJECTION for a whole league-week is a FAILURE (the sync is
 *      not landing) — the rows are still written for the fallback keys.
 *   J4 AN EMPTY ROSTER is a failure, nothing written.
 *   J5 A LEAGUE WITH NO league_weeks ROW for a planned week is named, not
 *      valued.
 *   J6 THE PLAN: season complete ⇒ an ok, named idle; an empty calendar ⇒ a
 *      failure; an explicit week the calendar lacks ⇒ a failure.
 *   J7 NO IN-SEASON LEAGUE ⇒ an ok, named idle (a warning).
 *   J8 A STALE LINE is named in a warning and treated as absent.
 */
import { describe, expect, it } from 'vitest'

import type { TimeProvider } from '../time/time-provider'
import { runLeaguePlayerValues } from './player-values-job'
import { SCORING_TEMPLATES } from './templates'

const SLEEPER_STD = { ...SCORING_TEMPLATES.find((t) => t.name === 'Sleeper Standard')!.rules }

const CAL = [
  { season: 2099, week: 3, starts_at: '2099-09-23T04:00:00Z', correction_window_ends_at: '2099-10-02T10:00:00Z' },
  { season: 2099, week: 4, starts_at: '2099-09-30T04:00:00Z', correction_window_ends_at: '2099-10-09T10:00:00Z' },
]
const NOW: TimeProvider = { now: () => new Date('2099-09-24T12:50:00.000Z') }
const FRESH = '2099-09-24T12:40:00.000Z'

interface Tables {
  nfl_weeks?: unknown[]
  leagues?: unknown[]
  league_weeks?: unknown[]
  league_rosters?: unknown[]
  players?: unknown[]
  player_weekly_projections?: unknown[]
  player_stats?: unknown[]
}
interface Call { table: string; op: string; rows?: unknown[] }

function fakeDb(tables: Tables, short: { upsert?: (sent: number) => number } = {}) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      let op = 'select'
      let payload: unknown[] = []
      const b: Record<string, unknown> = {}
      const chain = () => b
      Object.assign(b, {
        select: chain, eq: chain, in: chain, is: chain, gte: chain, lt: chain, not: chain, order: chain, range: chain,
        upsert: (rows: unknown[]) => { op = 'upsert'; payload = rows; calls.push({ table, op, rows }); return b },
        delete: () => { op = 'delete'; calls.push({ table, op }); return b },
        then(resolve: (v: unknown) => void) {
          if (op === 'upsert') return resolve({ data: null, error: null, count: (short.upsert ?? ((n) => n))(payload.length) })
          if (op === 'delete') return resolve({ data: null, error: null, count: 0 })
          const data = (tables as Record<string, unknown[] | undefined>)[table] ?? []
          return resolve({ data, error: null, count: data.length })
        },
      })
      return b
    },
  }
  return { db: db as never, calls }
}

const league = (id: string, snapshot: unknown) => ({ id, season: 2099, scoring_rules_snapshot: snapshot })
const player = (id: string, position: string) => ({
  id, position, projected_stats: {}, projections_season: null, projected_pts_ppr: null, projected_pts_standard: null, projected_pts_half_ppr: null,
})
const upserts = (calls: Call[]) => calls.filter((c) => c.table === 'league_player_values' && c.op === 'upsert')

describe('runLeaguePlayerValues — the loud arms (fake client)', () => {
  it('J1 QUARANTINE: a NULL and a corrupt snapshot fail THEIR league by name; the sibling is valued', async () => {
    const { db, calls } = fakeDb({
      nfl_weeks: CAL,
      leagues: [league('A', null), league('B', { pass_yards: 'corrupt' }), league('C', SLEEPER_STD)],
      league_weeks: ['A', 'B', 'C'].map((league_id) => ({ league_id, week: 3 })),
      league_rosters: [{ league_id: 'C', player_id: 'wr1' }],
      players: [player('wr1', 'WR')],
      player_weekly_projections: [{ week: 3, player_id: 'wr1', stats: { receiving_yards: 80 }, fetched_at: FRESH }],
    })
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([
      expect.stringMatching(/^league A week 3: snapshot_missing: .*nothing valued for this league$/),
      expect.stringMatching(/^league B week 3: snapshot_corrupt: .*pass_yards.*nothing valued for this league$/),
    ])
    const written = upserts(calls)
    expect(written).toHaveLength(1)
    expect((written[0].rows as Array<{ league_id: string; projected_points: number }>).map((r) => [r.league_id, r.projected_points])).toEqual([['C', 8]])
    expect(report.leagueWeeks.find((lw) => lw.league_id === 'C')).toMatchObject({ ok: true, written: 1, projected: 1 })
  })

  it('J2 a SHORT UPSERT is a named failure', async () => {
    const { db } = fakeDb(
      {
        nfl_weeks: CAL,
        leagues: [league('C', SLEEPER_STD)],
        league_weeks: [{ league_id: 'C', week: 3 }],
        league_rosters: [{ league_id: 'C', player_id: 'wr1' }],
        players: [player('wr1', 'WR')],
        player_weekly_projections: [{ week: 3, player_id: 'wr1', stats: { receiving_yards: 80 }, fetched_at: FRESH }],
      },
      { upsert: (n) => n - 1 },
    )
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['league C week 3: upsert wrote 0 row(s) for 1 sent — refusing to call that done'])
  })

  it('J3 NO usable projection for any rostered player ⇒ a FAILURE by name; the rows are still written (fallback keys stay current)', async () => {
    const { db, calls } = fakeDb({
      nfl_weeks: CAL,
      leagues: [league('C', SLEEPER_STD)],
      league_weeks: [{ league_id: 'C', week: 3 }],
      league_rosters: [{ league_id: 'C', player_id: 'wr1' }, { league_id: 'C', player_id: 'wr2' }],
      players: [player('wr1', 'WR'), player('wr2', 'WR')],
      player_weekly_projections: [{ week: 3, player_id: 'wr2', stats: { receiving_yards: 80 }, fetched_at: '2099-09-24T06:49:59.999Z' }],
    })
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([
      'league C week 3: NO usable weekly projection for any of 2 rostered player(s) (1 stale, 1 no line) — the projections sync is not landing; values written with their fallback keys only',
    ])
    expect(upserts(calls)).toHaveLength(1)
    expect(report.leagueWeeks[0]).toMatchObject({ written: 2, projected: 0, stale: 1, noLine: 1 })
  })

  it('J4 an EMPTY ROSTER is a failure, nothing written', async () => {
    const { db, calls } = fakeDb({ nfl_weeks: CAL, leagues: [league('C', SLEEPER_STD)], league_weeks: [{ league_id: 'C', week: 3 }] })
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.failures).toEqual([expect.stringMatching(/^league C week 3: no rostered player — no values/)])
    expect(upserts(calls)).toHaveLength(0)
  })

  it('J5 a league with no league_weeks row for the week is NAMED, not valued (and not a failure)', async () => {
    const { db, calls } = fakeDb({
      nfl_weeks: CAL,
      leagues: [league('C', SLEEPER_STD)],
      league_weeks: [],
      league_rosters: [{ league_id: 'C', player_id: 'wr1' }],
      players: [player('wr1', 'WR')],
    })
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.ok).toBe(true)
    expect(report.notScheduled).toEqual([{ league_id: 'C', week: 3 }])
    expect(upserts(calls)).toHaveLength(0)
  })

  it('J6 the plan: season complete is a named, ok idle; an empty calendar and an unknown explicit week are failures', async () => {
    const over = await runLeaguePlayerValues({ db: fakeDb({ nfl_weeks: CAL }).db, time: { now: () => new Date('2099-10-09T10:00:00Z') } }, { season: 2099 })
    expect([over.ok, over.plan.seasonComplete, over.failures]).toEqual([true, true, []])
    const empty = await runLeaguePlayerValues({ db: fakeDb({ nfl_weeks: [] }).db, time: NOW }, { season: 2099 })
    expect([empty.ok, empty.failures]).toEqual([false, ['nothing planned: no nfl_weeks rows for the season — nothing to plan (the calendar is empty)']])
    const unknown = await runLeaguePlayerValues({ db: fakeDb({ nfl_weeks: CAL }).db, time: NOW }, { season: 2099, weeks: [19] })
    expect(unknown.failures).toEqual(['week 19: not in nfl_weeks for season 2099 — the calendar decides which weeks exist (§23.3); nothing valued'])
  })

  it('J7 no in-season league: an ok, NAMED idle — and the plan is the current + next calendar week at the injected instant', async () => {
    const report = await runLeaguePlayerValues({ db: fakeDb({ nfl_weeks: CAL, leagues: [] }).db, time: NOW }, { season: 2099 })
    expect([report.ok, report.plan.weeks, report.warnings]).toEqual([true, [3, 4], ['no in_season / playoffs league for season 2099 — nothing to value']])
  })

  it('J8 a stale line is named in a warning and valued as absent', async () => {
    const { db } = fakeDb({
      nfl_weeks: CAL,
      leagues: [league('C', SLEEPER_STD)],
      league_weeks: [{ league_id: 'C', week: 3 }],
      league_rosters: [{ league_id: 'C', player_id: 'wr1' }, { league_id: 'C', player_id: 'wr2' }],
      players: [player('wr1', 'WR'), player('wr2', 'WR')],
      player_weekly_projections: [
        { week: 3, player_id: 'wr1', stats: { receiving_yards: 80 }, fetched_at: FRESH },
        { week: 3, player_id: 'wr2', stats: { receiving_yards: 80 }, fetched_at: '2099-09-24T06:49:59.999Z' },
      ],
    })
    const report = await runLeaguePlayerValues({ db, time: NOW }, { season: 2099, weeks: [3] })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual(['league C week 3: 1 projection line(s) older than the freshness bound — treated as absent: wr2'])
    expect(report.leagueWeeks[0]).toMatchObject({ projected: 1, stale: 1, noLine: 0 })
  })
})
