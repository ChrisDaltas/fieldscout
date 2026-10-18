import { describe, expect, it } from 'vitest'

import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'

import {
  ageText,
  draftLabel,
  draftTimeText,
  hasCurrentRoster,
  homeAlertLabel,
  homeAlertReasons,
  type HomeAlertInput,
  injuryNote,
  injuryPillClass,
  leaguePhase,
  leagueSize,
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

  it('league size and scoring, as the Switch league sheet names it (gap list §3 #20)', () => {
    expect(leagueSize(12, 'ppr')).toBe('12-team PPR')
    expect(leagueSize(12, 'standard')).toBe('12-team standard')
    expect(leagueSize(10, 'half_ppr')).toBe('10-team half PPR')
    // Unreadable scoring is left out, never guessed.
    expect(leagueSize(8, null)).toBe('8-team')
  })

  it('a draft time reads "Aug 28 · 7:00 PM" in the viewer’s clock', () => {
    // 23:00 UTC is 7:00 PM in New York (EDT) and 4:00 PM in Los Angeles.
    expect(draftTimeText('2026-08-28T23:00:00Z', 'America/New_York')?.replace(/\u202f/g, ' ')).toBe('Aug 28 · 7:00 PM')
    expect(draftTimeText('2026-08-28T23:00:00Z', 'America/Los_Angeles')?.replace(/\u202f/g, ' ')).toBe('Aug 28 · 4:00 PM')
    expect(draftTimeText('2026-08-28T23:00:00Z', 'America/New_York', true)).toBe('Aug 28')
    expect(draftTimeText('not a time')).toBeNull()
  })

  it('the draft line: "Draft live", the draft time, "Pre-draft" without one, nothing in season (gap list §3 #20)', () => {
    const now = Date.parse('2026-08-20T12:00:00Z')
    const at = '2026-08-28T23:00:00Z'
    const tz = 'America/New_York'
    const plain = (s: string | null) => s?.replace(/\u202f/g, ' ') ?? null
    expect(plain(draftLabel('pre-draft', at, now, { timeZone: tz }))).toBe('Draft Aug 28 · 7:00 PM')
    // The switcher strip's short form (handoff LEAGUES rec "Draft Aug 28").
    expect(draftLabel('pre-draft', at, now, { timeZone: tz, dayOnly: true })).toBe('Draft Aug 28')
    expect(draftLabel('draft-live', at, now, { timeZone: tz, dayOnly: true })).toBe('Draft live')
    expect(draftLabel('pre-draft', null, now, { timeZone: tz, dayOnly: true })).toBe('Pre-draft')
    expect(draftLabel('pre-draft', null, now, { timeZone: tz })).toBe('Pre-draft')
    expect(draftLabel('pre-draft', undefined, now, { timeZone: tz })).toBe('Pre-draft')
    // A time that has gone by without the draft starting is no longer "when".
    expect(draftLabel('pre-draft', at, Date.parse('2026-08-29T00:00:00Z'), { timeZone: tz })).toBe('Pre-draft')
    expect(draftLabel('pre-draft', 'garbage', now, { timeZone: tz })).toBe('Pre-draft')
    // During the draft — never "Pre-draft", whatever time was saved.
    expect(draftLabel('draft-live', at, now, { timeZone: tz })).toBe('Draft live')
    expect(draftLabel('draft-live', null, now, { timeZone: tz })).toBe('Draft live')
    expect(draftLabel('season', at, now, { timeZone: tz })).toBeNull()
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
    expect(injuryPillClass('Questionable')).toBe('bg-warn text-white')
    // The bright red is text, never a fill (2026-10-18): Out is the red tint.
    expect(injuryPillClass('Out')).toBe('bg-m-gr text-m-tr')
    expect(injuryPillClass('Doubtful')).toBe('bg-m-gr text-m-tr')
    expect(injuryPillClass('IR')).toBe('bg-m-ink text-white')
  })

  it('AI expert ages', () => {
    const now = Date.UTC(2026, 9, 15)
    expect(ageText(new Date(now - 3600_000).toISOString(), now)).toBe('today')
    expect(ageText(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('3d ago')
    expect(ageText(new Date(now - 15 * 86_400_000).toISOString(), now)).toBe('2w ago')
  })
})

describe('the league card red dot (ruling #14)', () => {
  // 1 QB · 1 RB · 1 FLEX (RB/WR), bench 2, one IR spot.
  const SETTINGS: RosterSettings = {
    starting_slots: [
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
      { key: 'flex', label: 'FLEX', eligible: ['RB', 'WR'], count: 1 },
    ],
    bench: 2,
    ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] }],
    swap_spots: 0,
  }
  const P = (id: string, position: string, over: Partial<RosterPlayer> = {}): RosterPlayer => ({
    player_id: id,
    full_name: id,
    position,
    nfl_team: 'KC',
    status: 'Active',
    bye_week: 10,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  })
  const ROSTER = [P('qb1', 'QB'), P('rb1', 'RB'), P('wr1', 'WR'), P('rb2', 'RB'), P('wr2', 'WR')]
  const FULL = { 'qb:0': 'qb1', 'rb:0': 'rb1', 'flex:0': 'wr1' }
  // Week 5 is being played; week 4 is final.
  const WEEKS = [
    { week: 4, status: 'final' },
    { week: 5, status: 'live' },
    { week: 6, status: 'upcoming' },
  ]
  const GAMES = [{ home_team: 'KC', away_team: 'DEN', kickoff_at: '2026-10-11T17:00:00Z' }, { home_team: 'BUF', away_team: 'MIA', kickoff_at: '2026-10-11T17:00:00Z' }]
  const base = (over: Partial<HomeAlertInput> = {}, lineup: Partial<NonNullable<HomeAlertInput['lineup']>> = {}): HomeAlertInput => ({
    status: 'in_season',
    myTeamId: 't1',
    schedule: { weeks: WEEKS, matchups: [{ week: 5, home_team_id: 't1', away_team_id: 't2' }] },
    offers: [],
    lineup: { roster: ROSTER, slotMap: FULL, settings: SETTINGS, games: GAMES, ...lineup },
    ...over,
  })
  const withStatus = (id: string, status: string) => ROSTER.map((p) => (p.player_id === id ? { ...p, status } : p))

  it('nothing needs you: a full, healthy lineup and no offer waiting', () => {
    expect(homeAlertReasons(base())).toEqual([])
    // Your own offers still out, and offers already answered, don't count.
    expect(homeAlertReasons(base({ offers: [{ awaitingMe: false }, { awaitingMe: false }] }))).toEqual([])
    expect(homeAlertLabel([])).toBeNull()
  })

  it('a trade offer waiting on your answer', () => {
    expect(homeAlertReasons(base({ offers: [{ awaitingMe: false }, { awaitingMe: true }] }))).toEqual(['trade'])
    expect(homeAlertLabel(['trade'])).toBe('Needs your attention: a trade offer is waiting for your answer')
  })

  it('a starter who is out, or on IR — Questionable and Doubtful are not', () => {
    expect(homeAlertReasons(base({}, { roster: withStatus('rb1', 'Out') }))).toEqual(['out'])
    expect(homeAlertReasons(base({}, { roster: withStatus('wr1', 'IR') }))).toEqual(['ir'])
    expect(homeAlertReasons(base({}, { roster: withStatus('rb1', 'Questionable') }))).toEqual([])
    expect(homeAlertReasons(base({}, { roster: withStatus('rb1', 'Doubtful') }))).toEqual([])
    // A benched player who is out needs nothing.
    expect(homeAlertReasons(base({}, { roster: withStatus('rb2', 'Out') }))).toEqual([])
  })

  it('a starter on bye — his bye week, or no game for his team in a week that has games', () => {
    const byeWeek = ROSTER.map((p) => (p.player_id === 'qb1' ? { ...p, bye_week: 5 } : p))
    expect(homeAlertReasons(base({}, { roster: byeWeek }))).toEqual(['bye'])
    const noGame = ROSTER.map((p) => (p.player_id === 'wr1' ? { ...p, nfl_team: 'SEA' } : p))
    expect(homeAlertReasons(base({}, { roster: noGame }))).toEqual(['bye'])
    // No games on record: only the stored bye week speaks.
    expect(homeAlertReasons(base({}, { roster: noGame, games: [] }))).toEqual([])
  })

  it('an empty starting slot — and no lineup row yet reads as every slot open', () => {
    expect(homeAlertReasons(base({}, { slotMap: { 'qb:0': 'qb1', 'rb:0': 'rb1' } }))).toEqual(['empty'])
    expect(homeAlertReasons(base({}, { slotMap: null }))).toEqual(['empty'])
    // A seat kept for a dropped starter who already played is not empty.
    expect(homeAlertReasons(base({}, { slotMap: { ...FULL, 'flex:0': 'gone' } }))).toEqual([])
  })

  it('every reason at once, named in order', () => {
    const roster = ROSTER.map((p) =>
      p.player_id === 'qb1' ? { ...p, status: 'Out' } : p.player_id === 'rb1' ? { ...p, status: 'IR' } : p,
    )
    const reasons = homeAlertReasons(base({ offers: [{ awaitingMe: true }] }, { roster, slotMap: { 'qb:0': 'qb1', 'rb:0': 'rb1' } }))
    expect(reasons).toEqual(['trade', 'out', 'ir', 'empty'])
    expect(homeAlertLabel(['trade', 'out', 'bye'])).toBe(
      'Needs your attention: a trade offer is waiting for your answer, a starter is out and a starter is on bye',
    )
  })

  it('a starter whose game has kicked off is locked — nothing to do, no dot', () => {
    const roster = ROSTER.map((p) =>
      p.player_id === 'rb1' ? { ...p, status: 'Out', game_lock: { state: 'locked_until' as const, until: '2026-10-14T04:00:00Z' } } : p,
    )
    expect(homeAlertReasons(base({}, { roster }))).toEqual([])
  })

  it('only a season being played: pre-draft, drafting and finished leagues show no dot', () => {
    for (const status of ['setup', 'scheduled', 'drafting', 'complete']) {
      expect(homeAlertReasons(base({ status, offers: [{ awaitingMe: true }] }, { slotMap: null })), status).toEqual([])
    }
    // No team in the league: nothing of yours to need you.
    expect(homeAlertReasons(base({ myTeamId: null, offers: [{ awaitingMe: true }] }))).toEqual([])
  })

  it('a finished week has no lineup to fix; a read that has not landed asserts nothing', () => {
    const over = [
      { week: 5, status: 'correction_window' },
      { week: 6, status: 'upcoming' },
    ]
    expect(homeAlertReasons(base({ schedule: { weeks: over, matchups: [] } }, { slotMap: null }))).toEqual([])
    expect(homeAlertReasons(base({ schedule: undefined }, { slotMap: null }))).toEqual([])
    expect(homeAlertReasons(base({ lineup: undefined }))).toEqual([])
    expect(homeAlertReasons(base({ offers: undefined }))).toEqual([])
    // The trade reason doesn't wait on the lineup reads.
    expect(homeAlertReasons(base({ schedule: undefined, lineup: undefined, offers: [{ awaitingMe: true }] }))).toEqual(['trade'])
  })

  it('in the playoffs only a team still playing this week', () => {
    const playoffs = (matchups: Array<{ week: number; home_team_id: string; away_team_id: string | null }>) =>
      homeAlertReasons(base({ status: 'playoffs', schedule: { weeks: WEEKS, matchups } }, { slotMap: null }))
    expect(playoffs([{ week: 5, home_team_id: 't3', away_team_id: 't1' }])).toEqual(['empty'])
    expect(playoffs([{ week: 5, home_team_id: 't3', away_team_id: 't4' }, { week: 4, home_team_id: 't1', away_team_id: 't2' }])).toEqual([])
    // A first-round bye (a row with no away team) isn't a game: no dot.
    expect(playoffs([{ week: 5, home_team_id: 't1', away_team_id: null }])).toEqual([])
    // A total-points season (no pairings) still counts every week.
    expect(homeAlertReasons(base({ schedule: { weeks: WEEKS, matchups: [] } }, { slotMap: null }))).toEqual(['empty'])
  })
})
