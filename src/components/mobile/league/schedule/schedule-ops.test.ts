import { describe, expect, it } from 'vitest'

import { NO_MATCHUPS_COPY, PLAYOFF_ROUND_PENDING_COPY } from '@/components/leagues/matchup-view-ops'
import { scheduleGrid } from '@/components/leagues/schedule-view-ops'
import { NAMES, SCHEDULE, matchup } from '@/components/leagues/standings-schedule.fixtures'

import {
  NO_GAME_COPY,
  NO_PLAYOFF_GAME_COPY,
  jumpWeek,
  phoneWeeks,
  rowLabel,
  scheduleHref,
  scheduleSearch,
  scheduleTeamFromParam,
  seasonLine,
} from './schedule-ops'

/** The fixture season: weeks 1–3 regular, week 4 a playoff week with no rows
 *  yet; week 1 final (a win and an adjusted tie), week 2 live, week 3
 *  upcoming with two second-opponent games. */
const GRID = scheduleGrid(SCHEDULE, NAMES, { regular_season_weeks: 3, schedule_mode: 'h2h' }, false)
const base = { teamId: null, myTeamId: null, currentWeek: 2, totalPoints: false }

describe('seasonLine', () => {
  it('counts the ladder’s weeks, the regular season and the playoffs', () => {
    expect(seasonLine(17, 14, false)).toBe('17 weeks · 14 regular season · 3 playoff')
    expect(seasonLine(14, 14, false)).toBe('14 weeks · 14 regular season')
    expect(seasonLine(1, 14, true)).toBe('1 week · 1 regular season · total points')
  })
})

describe('the team filter (?team=)', () => {
  it('reads a team that is one of the chips, else every team', () => {
    expect(scheduleTeamFromParam('t2', ['t1', 't2'])).toBe('t2')
    expect(scheduleTeamFromParam('gone', ['t1', 't2'])).toBeNull()
    expect(scheduleTeamFromParam(null, ['t1'])).toBeNull()
  })

  it('writes the team into the address, keeping the rest; every team is the bare address', () => {
    expect(scheduleSearch('', 't2')).toBe('?team=t2')
    expect(scheduleSearch('?x=1&team=t1', 't2')).toBe('?x=1&team=t2')
    expect(scheduleSearch('?team=t1', null)).toBe('')
    expect(scheduleSearch('?x=1&team=t1', null)).toBe('?x=1')
  })

  it('links the page, opened on a team when one is named', () => {
    expect(scheduleHref('lg1')).toBe('/app/leagues/lg1/schedule')
    expect(scheduleHref('lg1', 't1')).toBe('/app/leagues/lg1/schedule?team=t1')
  })
})

describe('phoneWeeks', () => {
  it('keeps every week in order, with its status, kind, median and the current week marked', () => {
    const weeks = phoneWeeks(GRID, base)
    expect(weeks.map((w) => [w.week, w.status, w.kind, w.isCurrent, w.median])).toEqual([
      [1, 'final', 'regular', false, 101.5],
      [2, 'live', 'regular', true, null],
      [3, 'upcoming', 'regular', false, null],
      [4, 'upcoming', 'playoff', false, null],
    ])
  })

  it('shows the stored scores as written — the loser greyed, a tie neither, an open score pending, an unstarted one a dash', () => {
    const [w1, w2, w3] = phoneWeeks(GRID, base)
    const win = w1!.primary[0]!
    expect([win.top.name, win.top.score, win.top.lost, win.bottom?.name, win.bottom?.score, win.bottom?.lost]).toEqual(['Alpha', '120.50', false, 'Bravo', '99.00', true])
    const tie = w1!.primary[1]!
    expect([tie.tie, tie.top.lost, tie.bottom?.lost, tie.overridden, tie.homeTeamId]).toEqual([true, false, false, true, 't3'])
    const live = w2!.primary[0]!
    expect([live.top.score, live.top.pending, live.bottom?.score, live.bottom?.pending]).toEqual(['40.25', false, 'pending', true])
    const later = w3!.primary[0]!
    expect([later.top.score, later.top.notStarted, later.top.pending]).toEqual(['—', true, false])
  })

  it('puts a second-opponent league’s extra games in their own group', () => {
    const w3 = phoneWeeks(GRID, base)[2]!
    expect(w3.primary.map((r) => r.id)).toEqual(['m5', 'm6'])
    expect(w3.secondary.map((r) => r.id)).toEqual(['m7', 'm8'])
  })

  it('puts your game first, you on top and tinted — home or away', () => {
    const w1 = phoneWeeks(GRID, { ...base, myTeamId: 't4' })[0]!
    expect(w1.primary.map((r) => r.id)).toEqual(['m2', 'm1'])
    expect([w1.primary[0]!.top.id, w1.primary[0]!.bottom?.id, w1.primary[0]!.mine]).toEqual(['t4', 't3', true])
    expect(w1.primary[1]!.mine).toBe(false)
  })

  it('a team chip keeps only that team’s games, the team on top', () => {
    const weeks = phoneWeeks(GRID, { ...base, teamId: 't2', myTeamId: 't1' })
    expect(weeks[0]!.primary.map((r) => [r.id, r.top.id])).toEqual([['m1', 't2']])
    expect(weeks[2]!.primary.map((r) => [r.id, r.top.id])).toEqual([['m6', 't2']])
    expect(weeks[2]!.secondary.map((r) => [r.id, r.top.id])).toEqual([['m7', 't2']])
    // Their game against you is still yours: tinted.
    expect(weeks[0]!.primary[0]!.mine).toBe(true)
  })

  it('your own chip doesn’t tint every row', () => {
    const weeks = phoneWeeks(GRID, { ...base, teamId: 't1', myTeamId: 't1' })
    expect(weeks.flatMap((w) => [...w.primary, ...w.secondary]).some((r) => r.mine)).toBe(false)
  })

  it('says why a week shows no game: the playoff round not set yet, nothing on record, or no game for the team', () => {
    expect(phoneWeeks(GRID, base)[3]!.note).toBe(PLAYOFF_ROUND_PENDING_COPY)
    expect(phoneWeeks(GRID, base).slice(0, 3).map((w) => w.note)).toEqual([null, null, null])
    const empty = scheduleGrid({ weeks: SCHEDULE.weeks.slice(0, 1), matchups: [] }, NAMES, { regular_season_weeks: 3, schedule_mode: 'h2h' }, false)
    expect(phoneWeeks(empty, base)[0]!.note).toBe(NO_MATCHUPS_COPY)

    // A bye-less week the team sits out (rows exist, none of them theirs).
    const sitOut = scheduleGrid(
      { weeks: SCHEDULE.weeks, matchups: [matchup({ id: 'p1', week: 4, home_team_id: 't1', away_team_id: 't2', round_type: 'playoff' }), matchup({ id: 'r1', week: 1, home_team_id: 't1', away_team_id: 't2' })] },
      NAMES,
      { regular_season_weeks: 3, schedule_mode: 'h2h' },
      false,
    )
    const t3 = phoneWeeks(sitOut, { ...base, teamId: 't3' })
    expect(t3[0]!.note).toBe(NO_GAME_COPY)
    expect(t3[3]!.note).toBe(NO_PLAYOFF_GAME_COPY)
  })

  it('a total-points league’s weeks carry no note — the page says it once', () => {
    const tp = scheduleGrid({ weeks: SCHEDULE.weeks, matchups: [] }, NAMES, { regular_season_weeks: 3, schedule_mode: 'total_points' }, false)
    expect(phoneWeeks(tp, { ...base, totalPoints: true }).map((w) => w.note)).toEqual([null, null, null, null])
  })

  it('tags consolation and third-place games; a bye has no bottom side', () => {
    const playoffs = scheduleGrid(
      {
        weeks: SCHEDULE.weeks,
        matchups: [
          matchup({ id: 'c1', week: 4, home_team_id: 't1', away_team_id: 't2', round_type: 'playoff' }),
          matchup({ id: 'c2', week: 4, home_team_id: 't3', away_team_id: 't4', round_type: 'consolation' }),
          matchup({ id: 'c3', week: 4, home_team_id: 't2', away_team_id: 't3', round_type: 'third_place' }),
          matchup({ id: 'c4', week: 4, home_team_id: 't4', away_team_id: null, round_type: 'playoff' }),
        ],
      },
      NAMES,
      { regular_season_weeks: 3, schedule_mode: 'h2h' },
      false,
    )
    const w4 = phoneWeeks(playoffs, base)[3]!
    expect(w4.primary.map((r) => [r.id, r.tag])).toEqual([
      ['c1', null],
      ['c2', 'Consolation'],
      ['c3', 'Third place'],
      ['c4', null],
    ])
    expect(w4.primary[3]!.bottom).toBeNull()
    expect(rowLabel(4, w4.primary[3]!)).toBe('Week 4: Delta — bye')
    expect(rowLabel(4, w4.primary[0]!)).toBe('Week 4: Alpha vs Bravo')
  })
})

describe('jumpWeek — where the screen opens', () => {
  const weeks = [{ week: 1 }, { week: 2 }, { week: 3 }]
  it('at the current week once the season is past its first week', () => {
    expect(jumpWeek(weeks, 2)).toBe(2)
    expect(jumpWeek(weeks, 3)).toBe(3)
  })
  it('at the top before that, with no ladder, or a week not on screen', () => {
    expect(jumpWeek(weeks, 1)).toBeNull()
    expect(jumpWeek(weeks, null)).toBeNull()
    expect(jumpWeek([], 2)).toBeNull()
    expect(jumpWeek(weeks, 9)).toBeNull()
  })
})
