import { describe, expect, it } from 'vitest'

import {
  ageText,
  hasCurrentRoster,
  injuryNote,
  injuryPillClass,
  leaguePhase,
  leagueSub,
  plural,
  projText,
  recordText,
  signedDelta,
  teamWithRecord,
  trendLists,
  trendSeeAllHref,
} from './home-ops'

describe('mobile Home ops (m-home §5)', () => {
  it('pluralises the My stuff subs', () => {
    expect(plural(1, 'list')).toBe('1 list')
    expect(plural(3, 'list')).toBe('3 lists')
    expect(plural(0, 'ranking')).toBe('0 rankings')
  })

  it('a league is pre-draft, drafting live, or playing its season', () => {
    expect(['setup', 'scheduled'].map(leaguePhase)).toEqual(['pre-draft', 'pre-draft'])
    // Desktop labels `drafting` "Draft live" — never "Pre-draft".
    expect(leaguePhase('drafting')).toBe('draft-live')
    expect(['in_season', 'playoffs', 'complete'].map(leaguePhase)).toEqual(['season', 'season', 'season'])
  })

  it("only this season's rosters make a player 'On your roster'", () => {
    expect(['drafting', 'in_season', 'playoffs'].map(hasCurrentRoster)).toEqual([true, true, true])
    // Not before the draft (no roster) and not a finished league (last season's).
    expect(['setup', 'scheduled', 'complete'].map(hasCurrentRoster)).toEqual([false, false, false])
  })

  it('Trending "See all" opens Available in a season league first, never a finished one', () => {
    const L = (id: string, status: string) => ({ id, status })
    expect(trendSeeAllHref([L('a', 'setup'), L('b', 'in_season')])).toBe('/app/leagues/b/players?status=avail')
    expect(trendSeeAllHref([L('a', 'complete'), L('b', 'scheduled')])).toBe('/app/leagues/b/players?status=avail')
    expect(trendSeeAllHref([L('a', 'complete')])).toBeNull()
    expect(trendSeeAllHref([])).toBeNull()
  })

  it('league sub: week in season, season before the draft, no guessed scoring', () => {
    expect(leagueSub({ teamCount: 12, family: 'standard', beforeSeason: false, season: 2026, week: 5 })).toBe('12-team standard · Week 5')
    expect(leagueSub({ teamCount: 12, family: 'ppr', beforeSeason: true, season: 2026, week: null })).toBe('12-team PPR · 2026')
    expect(leagueSub({ teamCount: 10, family: 'half_ppr', beforeSeason: false, season: 2026, week: 3 })).toBe('10-team half PPR · Week 3')
    expect(leagueSub({ teamCount: 8, family: null, beforeSeason: false, season: 2026, week: null })).toBe('8-team · 2026')
  })

  it('records come from the final standings; 0-0 only when nothing is final', () => {
    const doc = { standings: [{ team_id: 'a', wins: 2, losses: 6, ties: 0 }, { team_id: 'b', wins: 3, losses: 4, ties: 1 }], reason: null }
    expect(recordText(doc, 'a')).toBe('2-6')
    expect(recordText(doc, 'b')).toBe('3-4-1')
    expect(recordText(doc, 'c')).toBeNull()
    expect(recordText({ standings: [], reason: 'no_final_weeks' }, 'a')).toBe('0-0')
    expect(recordText(undefined, 'a')).toBeNull()
    expect(teamWithRecord('Touchdown Tacos', '2-6')).toBe('Touchdown Tacos (2-6)')
    expect(teamWithRecord('Touchdown Tacos', null)).toBe('Touchdown Tacos')
  })

  it('Proj shows two decimals and never a partial sum', () => {
    expect(projText({ total: 83.44, missing: 0 }, 9)).toBe('Proj 83.44')
    expect(projText({ total: 83.44, missing: 1 }, 9)).toBeNull()
    expect(projText({ total: 0, missing: 0 }, 0)).toBeNull()
    expect(projText(null, 9)).toBeNull()
  })

  it('signed deltas use a real minus', () => {
    expect(signedDelta(12.34)).toBe('+12.3')
    expect(signedDelta(-4)).toBe('−4.0')
  })

  it('trend lists: risers biggest gain first, fallers biggest drop first, irrelevant players out', () => {
    const p = (id: string, projected_pts: number | null, last_pts: number, last_games = 16) => ({ id, projected_pts, last_pts, last_games })
    const players = [p('a', 200, 150), p('b', 180, 200), p('c', 300, 220), p('d', 120, 190), p('e', 40, 10), p('f', 150, 100, 4), p('g', null, 0)]
    const { risers, fallers } = trendLists(players, 5)
    expect(risers.map((e) => e.player.id)).toEqual(['c', 'a'])
    expect(fallers.map((e) => e.player.id)).toEqual(['d', 'b'])
  })

  it('injury note and pill colour', () => {
    expect(injuryNote({ injury_body_part: 'Ankle', injury_notes: 'Sprain', practice_participation: 'Limited' })).toBe('Ankle · Sprain · limited practice')
    expect(injuryNote({ injury_body_part: null, injury_notes: null, practice_participation: null })).toBeNull()
    expect(injuryPillClass('Questionable')).toBe('bg-warn')
    expect(injuryPillClass('Out')).toBe('bg-negative-strong')
    expect(injuryPillClass('IR')).toBe('bg-m-ink')
  })

  it('AI expert ages', () => {
    const now = Date.UTC(2026, 9, 15)
    expect(ageText(new Date(now - 3600_000).toISOString(), now)).toBe('today')
    expect(ageText(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('3d ago')
    expect(ageText(new Date(now - 15 * 86_400_000).toISOString(), now)).toBe('2w ago')
  })
})
