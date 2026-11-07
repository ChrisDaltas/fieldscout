/**
 * stat-fix-rescore.test.ts — what OUR OWN stat fix pays a final week, and
 * nothing else (migration 222; PROGRESS D836–D839). Chris 2026-11-07,
 * verbatim: "the stats need to be correct. that should be done
 * automatically" and "just update the points as they should be so we can
 * move on."; standing: F405 / Q81 — a provider's late correction never
 * changes a final week.
 *
 * Every number is a stored literal worked out by hand from the real Sleeper
 * line (`sleeper-league-plays.json`) and the template, the same lines
 * `league-plays-golden.test.ts` pins:
 *   - Aubrey 2026 wk2 (fgm_20_29, fgm_40_49, fgm_50p 1 with fgm_60p 1, 4
 *     PATs). The fills moved fg_0_39 0 → 1 and fg_60_plus 0 → 1. Under a
 *     week document from before 218 (no fg_60_plus key — weeks 1–8): after =
 *     3 + 4 + 5 + 4 = 16, before = 4 + 5 + 4 = 13 ⇒ +3. Under 218's ESPN
 *     document: 17 − 13 ⇒ +4. Scout (a flat 3 every field goal): 13 − 10 ⇒ +3.
 *   - Tampa Bay 2026 wk7 (5 sacks, 2 INT, fum_rec 1 + def_st_fum_rec 1, a
 *     D/ST TD, a block, def_2pt 1, 13 allowed, 266 yards). The backlog moved
 *     def_fumble_recoveries 1 → 2 (F890's by-player string), def_block 0 → 1
 *     and def_2pt_return 0 → 1. Pre-218 ESPN: one more recovery 2 + the block
 *     2 ⇒ +4 (26 − 22); 218's ESPN pays the two-point return 2 more ⇒ +6.
 *   - Myles Price 2026 wk3: a return TD on a line that had NO row — return_td
 *     0 → 1, ESPN 6 ⇒ +6, and his stored `no_stat_row` 0 becomes 6 `scored`.
 *   - Brandon Aubrey 2025 wk15: 6 rushing yards — the engine fix written as a
 *     line (rush_yards 0 → 6), ESPN base 0.1 ⇒ +0.60.
 */
import { describe, expect, it } from 'vitest'

import { recordedActual, storedLine } from '@/lib/players/preset-scoring.fixtures'

import type { ScoringRulesDoc } from './rules-doc'
import { type StatLineRow } from './score-week-worker'
import { doorTeams, lineAt, type PlanTeamIn, planLeagueWeekFix, planWeekFix, plannedRowWrites, type StatFixLine, starterFixDelta, type StoredRowIn, type WeekFixPlan } from './stat-fix-rescore'
import { SCORING_TEMPLATES } from './templates'

const template = (name: string) => {
  const found = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!found) throw new Error(`no template named ${name}`)
  return found.rules as unknown as ScoringRulesDoc
}
const ESPN = template('ESPN Standard')
const SCOUT = template('Scout Standard')
/** A week whose stored document predates 218: weeks 1–8 keep the rules they were played with (Q64). */
const pre218 = (doc: ScoringRulesDoc) =>
  Object.fromEntries(Object.entries(doc as unknown as Record<string, number>).filter(([key]) => key !== 'fg_60_plus' && key !== 'def_2pt_return')) as unknown as ScoringRulesDoc
const ESPN_WK = pre218(ESPN)

const line = (key: string): StatLineRow => storedLine(recordedActual(key).stats)
const fix = (week: number, player_id: string, stat_key: string, before: number, after: number): StatFixLine => ({ week, player_id, stat_key, before, after })

const AUBREY = line('aubrey_2026_wk2')
const AUBREY_FIX = [fix(2, 'aub', 'fg_0_39', 0, 1), fix(2, 'aub', 'fg_60_plus', 0, 1)]
const TB = line('tb_2026_wk7')
const TB_FIX = [fix(7, 'tb', 'def_fumble_recoveries', 1, 2), fix(7, 'tb', 'def_block', 0, 1), fix(7, 'tb', 'def_2pt_return', 0, 1)]

describe('the premise: the lines carry what the fills wrote', () => {
  it('Aubrey 2026 wk2 reads fg_0_39 1 and fg_60_plus 1; Tampa Bay 2026 wk7 reads 2 recoveries, a block and a two-point return', () => {
    expect([AUBREY.fg_0_39, AUBREY.fg_60_plus]).toEqual([1, 1])
    expect([TB.def_fumble_recoveries, TB.def_block, TB.def_2pt_return, TB.def_return_td]).toEqual([2, 1, 1, 0])
  })

  it('lineAt sets exactly the fix’s keys and nothing else', () => {
    const before = lineAt(TB, TB_FIX, 'before')
    expect([before.def_fumble_recoveries, before.def_block, before.def_2pt_return]).toEqual([1, 0, 0])
    expect({ ...before, def_fumble_recoveries: TB.def_fumble_recoveries, def_block: TB.def_block, def_2pt_return: TB.def_2pt_return }).toEqual(TB)
    expect(lineAt(TB, TB_FIX, 'after')).toEqual(TB)
  })
})

describe('starterFixDelta — what our change pays, under each week’s own rules (stored literals)', () => {
  it('Aubrey 2026 wk2: +3 under a pre-218 week (fg_60_plus is not in that week’s rules), +4 under 218’s ESPN, +3 under Scout', () => {
    expect(starterFixDelta(ESPN_WK, 'aub', 'K', AUBREY, AUBREY_FIX)).toEqual({ player_id: 'aub', before: 13, after: 16, delta: 3, reason: 'scored' })
    expect(starterFixDelta(ESPN, 'aub', 'K', AUBREY, AUBREY_FIX)).toMatchObject({ before: 13, after: 17, delta: 4 })
    expect(starterFixDelta(SCOUT, 'aub', 'K', AUBREY, AUBREY_FIX)).toMatchObject({ before: 10, after: 13, delta: 3 })
  })

  it('Tampa Bay 2026 wk7: +4 under a pre-218 week (a recovery 2 + a block 2), +6 under 218’s ESPN (the two-point return 2)', () => {
    expect(starterFixDelta(ESPN_WK, 'tb', 'DST', TB, TB_FIX)).toMatchObject({ before: 22, after: 26, delta: 4 })
    expect(starterFixDelta(ESPN, 'tb', 'DST', TB, TB_FIX)).toMatchObject({ before: 22, after: 28, delta: 6 })
  })

  it('def_fumble_recoveries 1 → 2 pays ONE recovery (2), not two', () => {
    expect(starterFixDelta(ESPN_WK, 'tb', 'DST', TB, [fix(7, 'tb', 'def_fumble_recoveries', 1, 2)]).delta).toBe(2)
  })

  it('F405 / Q81: a provider’s late correction on ANOTHER key sits in both terms and cancels — the delta is unchanged (a full recompute would pay it)', () => {
    const corrected = { ...TB, def_sacks: Number(TB.def_sacks) + 1 } // the provider found a 6th sack after the window
    const d = starterFixDelta(ESPN_WK, 'tb', 'DST', corrected, TB_FIX)
    expect(d).toMatchObject({ before: 23, after: 27, delta: 4 })
    // What a recompute from today's line would have paid over the stored 22: the provider's sack too.
    expect(d.after - 22).toBe(5)
  })

  it('F405 / Q81: a provider correction on the SAME key past our after value is not ours either — the fix pays its own move only', () => {
    const corrected = { ...TB, def_fumble_recoveries: 3 } // our fill wrote 2; the provider later read 3
    expect(starterFixDelta(ESPN_WK, 'tb', 'DST', corrected, [fix(7, 'tb', 'def_fumble_recoveries', 1, 2)]).delta).toBe(2)
  })

  it('a NEW line (no row before; before 0): Price 2026 wk3’s return TD pays 6', () => {
    expect(starterFixDelta(ESPN_WK, 'price', 'WR', line('price_2026_wk3'), [fix(3, 'price', 'return_td', 0, 1)])).toMatchObject({ before: 0, after: 6, delta: 6, reason: 'scored' })
  })

  it('an ENGINE fix written as a line: a kicker’s 6 rushing yards (rush_yards 0 → 6) pay ESPN’s base 0.1 a yard, +0.60', () => {
    expect(starterFixDelta(ESPN_WK, 'aub', 'K', line('aubrey_2025_wk15'), [fix(15, 'aub', 'rush_yards', 0, 6)]).delta).toBe(0.6)
  })
})

// ── planWeekFix ─────────────────────────────────────────────────────────────

const row = (team_id: string, slot: string, player_id: string, points: number, reason: 'scored' | 'no_stat_row' = 'scored'): StoredRowIn => ({
  team_id,
  slot,
  player_id,
  points,
  pending: [],
  reason,
  source: 'worker',
})

function week(teams: PlanTeamIn[], lines: StatFixLine[], stats: Record<string, StatLineRow>, positions: Record<string, string>, held: string[] = []) {
  return planWeekFix({ rules: ESPN_WK, teams, lines, stats: new Map(Object.entries(stats)), positions: new Map(Object.entries(positions)), held: new Set(held) })
}

describe('planWeekFix — the week at stored + our change, from the STORED rows', () => {
  const one: PlanTeamIn = { team_id: 'T1', cells: [95], overridden_cells: 0, rows: [row('T1', 'qb:0', 'q1', 55), row('T1', 'k:0', 'aub', 40)] }
  const two: PlanTeamIn = { team_id: 'T2', cells: [101.4], overridden_cells: 0, rows: [row('T2', 'qb:0', 'q2', 61.4), row('T2', 'dst:0', 'tb', 40)] }

  it('each fixed starter’s row is stored + delta (marked with what it was planned from); the team’s score is Σ its rows', () => {
    const plan = week([one, two], [...AUBREY_FIX, ...TB_FIX], { aub: AUBREY, tb: TB }, { aub: 'K', tb: 'DST' })
    expect(plan.problems).toEqual([])
    const t1 = plan.teams.find((t) => t.team_id === 'T1')!
    const t2 = plan.teams.find((t) => t.team_id === 'T2')!
    expect(t1.players).toEqual([
      { slot: 'k:0', player_id: 'aub', points: 43, pending: [], reason: 'scored', stored: 40, delta: 3 },
      { slot: 'qb:0', player_id: 'q1', points: 55, pending: [], reason: 'scored', stored: 55, delta: 0 },
    ])
    expect([t1.stored_sum, t1.points, t1.changed.length, t1.writable]).toEqual([95, 98, 1, true])
    expect([t2.stored_sum, t2.points]).toEqual([101.4, 105.4])
  })

  it('F405 / Q81 at the row: a fixed starter whose line ALSO carries a provider correction is stored + our delta only — never today’s whole line', () => {
    const corrected = { ...TB, def_sacks: Number(TB.def_sacks) + 1 }
    const plan = week([{ team_id: 'T7', cells: [22], overridden_cells: 0, rows: [row('T7', 'dst:0', 'tb', 22)] }], TB_FIX, { tb: corrected }, { tb: 'DST' })
    expect(plan.teams[0].changed).toEqual([{ slot: 'dst:0', player_id: 'tb', points: 26, pending: [], reason: 'scored', stored: 22, delta: 4 }])
    expect(plan.teams[0].points).toBe(26) // a recompute of today's line would say 27
  })

  it('a non-starter is ignored: a fix line for a player no stored row starts changes nothing', () => {
    const plan = week([one], [fix(2, 'bench-k', 'fg_0_39', 0, 3)], { 'bench-k': AUBREY }, { 'bench-k': 'K' })
    expect([plan.problems, plan.teams[0].changed, plan.teams[0].points]).toEqual([[], [], 95])
  })

  it('the stored lineup, never slot_map: the rows are the stored rows, slot for slot', () => {
    const plan = week([one], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' })
    expect(plan.teams[0].players.map((p) => `${p.slot}=${p.player_id}`)).toEqual(['k:0=aub', 'qb:0=q1'])
  })

  it('a new line: a stored `no_stat_row` 0 becomes a `scored` 6', () => {
    const plan = week([{ team_id: 'T3', cells: [10], overridden_cells: 0, rows: [row('T3', 'wr:0', 'price', 0, 'no_stat_row'), row('T3', 'qb:0', 'q3', 10)] }], [fix(3, 'price', 'return_td', 0, 1)], { price: line('price_2026_wk3') }, { price: 'WR' })
    expect(plan.teams[0].changed).toEqual([{ slot: 'wr:0', player_id: 'price', points: 6, pending: [], reason: 'scored', stored: 0, delta: 6 }])
    expect(plan.teams[0].points).toBe(16)
  })

  it('rounding: stored 1.10 + a 2.20 fix is 3.30 (the per-player stored precision), and the team Σ is exact cents', () => {
    const wr = { ...line('price_2026_wk3'), receiving_yards: 22 }
    const plan = week([{ team_id: 'T4', cells: [1.2], overridden_cells: 0, rows: [row('T4', 'wr:0', 'w', 1.1), row('T4', 'te:0', 'te', 0.1)] }], [fix(4, 'w', 'receiving_yards', 0, 22)], { w: wr }, { w: 'WR' })
    expect(plan.teams[0].changed[0]).toMatchObject({ stored: 1.1, delta: 2.2, points: 3.3 })
    expect(plan.teams[0].points).toBe(3.4)
  })

  it('an OVERRIDDEN team (every cell the commissioner’s) is planned but not writable — the door keeps its score and its rows (158)', () => {
    const kept: PlanTeamIn = { team_id: 'T5', cells: [], overridden_cells: 1, rows: [row('T5', 'k:0', 'aub', 40)] }
    const plan = week([one, kept], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' })
    const t5 = plan.teams.find((t) => t.team_id === 'T5')!
    expect([t5.writable, t5.changed.length, t5.points]).toEqual([false, 1, 43])
    const wp: WeekFixPlan = { league_id: 'L', league_name: 'L', season: 2026, week: 2, schedule_mode: 'h2h', ineligible: null, teams: plan.teams, problems: [] }
    expect(plannedRowWrites(wp)).toBe(1) // T1's kicker only
  })

  it('a held game (184): a fixed starter on it scores nothing either way — no change', () => {
    const plan = week([one], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' }, ['aub'])
    expect([plan.problems, plan.teams[0].changed]).toEqual([[], []])
  })

  it('rows_drift: a writable team whose stored score is not the sum of its stored rows is a PROBLEM by name (what was scored is unknown)', () => {
    const drifted: PlanTeamIn = { ...one, cells: [96] }
    expect(week([drifted], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' }).problems).toEqual([
      'team T1: rows_drift — its stored score 96.00 is not the sum of its stored rows (95.00); a fix adds our change to what was scored, and that is not known here',
    ])
    const noRows: PlanTeamIn = { team_id: 'T6', cells: [12], overridden_cells: 0, rows: [] }
    expect(week([noRows], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' }).problems).toEqual([
      'team T6: rows_drift — its stored score 12.00 is not the sum of its stored rows (none); a fix adds our change to what was scored, and that is not known here',
    ])
  })

  it('a fixed starter with no line today, or one players does not know, is a PROBLEM — never a fix read onto nothing', () => {
    expect(week([one], AUBREY_FIX, {}, { aub: 'K' }).problems).toEqual([
      'team T1: starter aub (k:0) has no stat line today, but the fix names him — refusing to read a fix onto nothing',
    ])
    expect(week([one], AUBREY_FIX, { aub: AUBREY }, {}).problems).toEqual(["team T1: starter aub (k:0) is not in players — his fix can't be scored"])
  })

  it('doorTeams: every team, every stored row, with the points it was planned from', () => {
    const plan = week([one], AUBREY_FIX, { aub: AUBREY }, { aub: 'K' })
    const wp: WeekFixPlan = { league_id: 'L', league_name: 'L', season: 2026, week: 2, schedule_mode: 'h2h', ineligible: null, teams: plan.teams, problems: [] }
    expect(doorTeams(wp)).toEqual([
      {
        team_id: 'T1',
        points: 98,
        players: [
          { slot: 'k:0', player_id: 'aub', points: 43, pending: [], reason: 'scored', stored: 40 },
          { slot: 'qb:0', player_id: 'q1', points: 55, pending: [], reason: 'scored', stored: 55 },
        ],
      },
    ])
  })
})

describe('planLeagueWeekFix — the door’s order of refusals, read before anything is planned', () => {
  /** A read-only fake: each table answers its rows; every filter is accepted. */
  function db(tables: Record<string, unknown[]>) {
    return {
      from: (table: string) => {
        const rows = tables[table] ?? []
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => builder,
          range: () => builder,
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length }),
        }
        return builder
      },
    } as never
  }
  const league = (over: Record<string, unknown> = {}) => ({ id: 'L', name: 'L', season: 2026, status: 'in_season', deleted_at: null, settings: {}, scoring_rules_snapshot: ESPN, ...over })

  it('archived, not in season, a built bracket, a week not final: each named, nothing planned (the CLI plan says "not eligible")', async () => {
    expect((await planLeagueWeekFix(db({ leagues: [league({ deleted_at: '2026-11-01T00:00:00Z' })] }), 'L', 1, AUBREY_FIX)).ineligible).toBe('league_archived')
    expect((await planLeagueWeekFix(db({ leagues: [league({ status: 'playoffs' })] }), 'L', 1, AUBREY_FIX)).ineligible).toBe('league_not_in_season (playoffs)')
    expect((await planLeagueWeekFix(db({ leagues: [league()], matchups: [{ id: 'm-playoff' }] }), 'L', 1, AUBREY_FIX)).ineligible).toBe('bracket_built')
    expect((await planLeagueWeekFix(db({ leagues: [league()], league_weeks: [{ week: 1, status: 'correction_window', scoring_rules_snapshot: ESPN }] }), 'L', 1, AUBREY_FIX)).ineligible).toBe(
      'week_not_final (correction_window)',
    )
  })
})

