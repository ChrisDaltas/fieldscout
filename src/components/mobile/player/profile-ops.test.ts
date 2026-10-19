import { describe, expect, it } from 'vitest'

import { scheduleRows, type TeamGame } from '@/components/players/player-page-ops'
import type { DraftPickSummary } from '@/hooks/use-draft'
import type { LeagueDetail } from '@/hooks/use-league'
import type { DepthChartPlayer } from '@/hooks/use-mobile-pprofile-depth-chart'
import type { ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import { resolveChoice, scoredLeagues, type CoreStatsPayload } from '@/lib/players/core-stats-ops'
import { PPR_SCORING, QUARTER_PPR_SCORING, STANDARD_SCORING } from '@/lib/scoring/default'

import {
  bioLine,
  careerTable,
  clearsDay,
  currentWeekOf,
  depthChart,
  experienceLabel,
  fptsTone,
  gameCards,
  gameLogTable,
  headerColors,
  initialCardIndex,
  isLightHex,
  keyStatTrends,
  leagueOwnership,
  movesTimeline,
  ownershipNeedsRosters,
  ownershipSummary,
  pastSeasonRules,
  playerMoves,
  PRESS,
  PROFILE_SCORING_SYSTEMS,
  profileScoringOptions,
  rankTone,
  scoringChipLabel,
  scoringChipName,
  statLine,
  statusPill,
  stripCells,
  teamLine,
  TREND_BETTER,
  trendIsGood,
  type ProfileMove,
} from './profile-ops'

function player(over: Partial<PlayerStatsPlayer> = {}): PlayerStatsPlayer {
  return {
    id: 'p1',
    full_name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    headshot_url: null,
    status: null,
    jersey_number: 7,
    height: '72',
    weight: 220,
    birth_date: '2002-01-30',
    college: null,
    experience_years: 3,
    bye_week: 5,
    draft_year: null,
    draft_round: null,
    draft_pick: null,
    adp: 3.4,
    sos: null,
    auction_value: null,
    injury_body_part: null,
    injury_notes: null,
    injury_start_date: null,
    practice_participation: null,
    ...over,
  }
}

function core(over: Partial<CoreStatsPayload> = {}): CoreStatsPayload {
  return {
    basis: { kind: 'system', system: 'espn_standard' },
    season: 2026,
    week: 6,
    total_points: 55,
    games: 4,
    avg_points: 13.75,
    projected_points: 15.2,
    pos_rank: 24,
    overall_rank: 60,
    weekly: [],
    box: { games: 4, totals: {} },
    usage: null,
    ...over,
  }
}

const game = (week: number, home: string, away: string, status: string, kickoff = '2026-10-18T17:00:00Z', state: Partial<TeamGame> = {}): TeamGame => ({
  week,
  home_team: home,
  away_team: away,
  kickoff_at: kickoff,
  status,
  ...state,
})

describe('pressed tints (gap list §4 item 18)', () => {
  it('a background tint per fill — never a shadow, never the bright red', () => {
    for (const cls of Object.values(PRESS)) {
      expect(cls).toMatch(/^active:bg-[\w/.-]+$/)
      expect(cls).not.toMatch(/shadow|negative-strong|m-red/)
    }
  })

  it('the handoff’s per-fill presses: page → b2, b1 card → b2h, b2 control → b3s, blue → strong blue', () => {
    expect(PRESS.page).toBe('active:bg-m-b2')
    expect(PRESS.card).toBe('active:bg-m-b2h')
    // Not b2h: phone dark mode draws b2h and b2 the same grey, so the press would vanish.
    expect(PRESS.control).toBe('active:bg-m-b3s')
    expect(PRESS.accent).toBe('active:bg-accent-strong')
    expect(PRESS.confirm).toBe('active:bg-confirm-hover')
  })
})

describe('header', () => {
  it('team colour from the app table; PIT and NO are the light ones', () => {
    expect(headerColors('ATL')).toEqual({ bg: '#A71930', light: false })
    expect(headerColors('PIT')?.light).toBe(true)
    expect(headerColors('NO')?.light).toBe(true)
    expect(headerColors('LV')?.light).toBe(false)
    expect(headerColors(null)).toBeNull()
    expect(isLightHex('#FFFFFF')).toBe(true)
  })

  it('team line: jersey number, D/ST team only, FA without a team', () => {
    expect(teamLine(player())).toBe('ATL · #7')
    expect(teamLine(player({ position: 'DEF', jersey_number: null }))).toBe('ATL')
    expect(teamLine(player({ team: null, jersey_number: null }))).toBe('FA')
  })

  it('bio line: present parts, Rookie in year one, D/ST wording', () => {
    const today = new Date('2026-10-15T12:00:00Z')
    expect(bioLine(player(), today)).toBe('Age 24 · 6\'0" · 220 lb · 4th season')
    expect(bioLine(player({ experience_years: 0, weight: null, height: null }), today)).toBe('Age 24 · Rookie')
    expect(bioLine(player({ position: 'DEF' }), today)).toBe('Defense / special teams')
    expect(experienceLabel(1)).toBe('2nd season')
  })

  it('injury pill: full word, orange for Q/D, red for Out and the lists', () => {
    expect(statusPill('Questionable')).toEqual({ label: 'Questionable', tone: 'warn' })
    expect(statusPill('Doubtful')?.tone).toBe('warn')
    expect(statusPill('Out')).toEqual({ label: 'Out', tone: 'negative' })
    expect(statusPill('IR')?.label).toBe('IR')
    expect(statusPill('Active')).toBeNull()
    expect(statusPill(null)).toBeNull()
  })
})

describe('stat strip', () => {
  it('rank · avg · season pts · bye — no rostered % (no source)', () => {
    expect(stripCells(core(), player(), 2026, 'RB').map((c) => [c.value, c.label])).toEqual([
      ['#24', 'RB rank'],
      ['13.8', 'Avg pts'],
      ['55.0', '2026 pts'],
      ['5', 'Bye week'],
    ])
  })

  it('missing values are dashes; no bye on file drops the cell', () => {
    const cells = stripCells(null, player({ bye_week: null }), 2026, 'D/ST')
    expect(cells.map((c) => c.value)).toEqual(['–', '–', '–'])
    expect(cells[0]!.label).toBe('D/ST rank')
  })
})

describe('scoring chip (gap list §3 #18)', () => {
  const leagues = [{ id: 'L1', name: 'Sunday Funday League' }]

  it('offers PPR · Half PPR · 0.25 PPR · Standard, then your leagues', () => {
    expect(profileScoringOptions(leagues)).toEqual([
      { value: 'ppr', label: 'PPR', sub: '1 point per catch' },
      { value: 'half_ppr', label: 'Half PPR', sub: '0.5 points per catch' },
      { value: 'quarter_ppr', label: '0.25 PPR', sub: '0.25 points per catch' },
      { value: 'espn_standard', label: 'Standard', sub: 'No points for a catch' },
      { value: 'league:L1', label: 'Sunday Funday League', sub: 'Your league’s scoring' },
    ])
    expect(PROFILE_SCORING_SYSTEMS).toEqual(['ppr', 'half_ppr', 'quarter_ppr', 'espn_standard'])
  })

  it('the chip says the preset’s short name, or "League"; its name says which', () => {
    const options = profileScoringOptions(leagues)
    expect(scoringChipLabel({ kind: 'system', system: 'espn_standard' })).toBe('Standard')
    expect(scoringChipLabel({ kind: 'system', system: 'quarter_ppr' })).toBe('0.25 PPR')
    expect(scoringChipLabel({ kind: 'league', leagueId: 'L1' })).toBe('League')
    expect(scoringChipName({ kind: 'system', system: 'half_ppr' }, options)).toBe('Scoring: Half PPR')
    expect(scoringChipName({ kind: 'league', leagueId: 'L1' }, options)).toBe('Scoring: Sunday Funday League')
  })

  it('a league still before its draft is not offered, and a remembered one falls back to Standard', () => {
    const mine = [
      { id: 'L1', name: 'Sunday Funday League', status: 'in_season' },
      { id: 'L2', name: 'Practice Squad League', status: 'setup' },
    ]
    const scored = scoredLeagues(mine)
    expect(profileScoringOptions(scored).map((o) => o.value)).toEqual(['ppr', 'half_ppr', 'quarter_ppr', 'espn_standard', 'league:L1'])
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:L2', leagues: scored, systems: PROFILE_SCORING_SYSTEMS })).toEqual({
      kind: 'system',
      system: 'espn_standard',
    })
  })
})

describe('games and projections cards', () => {
  const games = [game(3, 'ATL', 'CAR', 'final'), game(4, 'LV', 'ATL', 'final'), game(6, 'ATL', 'PHI', 'scheduled'), game(7, 'TB', 'ATL', 'scheduled')]
  const splits = [
    { defense: 'CAR', position: 'RB', rank: 1 },
    { defense: 'LV', position: 'RB', rank: 32 },
    { defense: 'PHI', position: 'RB', rank: 16 },
  ]
  const schedule = scheduleRows('ATL', 'RB', games, splits, 5)
  const lines: ProfileStatLine[] = [{ season: 2026, week: 4, is_live: false, rush_attempts: 16, rush_yards: 80, receptions: 3, receiving_yards: 17 }]
  const cards = gameCards({
    team: 'ATL',
    schedule,
    games,
    weekly: [
      { week: 3, points: 9, proj: 12 },
      { week: 4, points: 14.4, proj: 12.1 },
      { week: 6, points: null, proj: 15.25 },
    ],
    lines,
    position: 'RB',
    currentWeek: 6,
  })

  it('played: points coloured against the projection, the box line', () => {
    const wk4 = cards.find((c) => c.week === 4)!
    expect(wk4).toMatchObject({ pill: 'played', opp: '@ LV', mainLabel: 'Points', main: '14.4', mainTone: 'up', sub: { label: 'Proj', value: '12.1' } })
    expect(wk4.line).toBe('16 car 80 yds · 3 rec 17 yds')
    expect(cards.find((c) => c.week === 3)!.mainTone).toBe('down')
  })

  it('OPRK in the platform orientation with its tone (1 = toughest)', () => {
    const wk3 = cards.find((c) => c.week === 3)!
    // 033 rank 1 = most generous → flipped: CAR is the easiest, LV the toughest.
    expect(wk3.oprk).toBe('(32nd)')
    expect(cards.find((c) => c.week === 4)!.oprk).toBe('(1st)')
  })

  it('bye card, current week ring and kickoff; upcoming without a projection', () => {
    expect(cards.find((c) => c.week === 5)).toMatchObject({ bye: true, pill: 'upcoming' })
    const wk6 = cards.find((c) => c.week === 6)!
    expect(wk6).toMatchObject({ current: true, pill: 'current', mainLabel: 'Projected', main: '15.3' })
    expect(wk6.sub?.label).toBe('Kickoff')
    expect(cards.find((c) => c.week === 7)).toMatchObject({ pill: 'upcoming', main: '–' })
  })

  it('the current week is the one being played, never next week while his game is on', () => {
    const live = [game(4, 'LV', 'ATL', 'final'), game(5, 'ATL', 'NO', 'live'), game(6, 'ATL', 'PHI', 'scheduled')]
    // thisWeek() would say 6 (the first game still scheduled) — the live game wins.
    expect(currentWeekOf(live, 6, 6)).toBe(5)
    // No game on: the NFL calendar's week, else the schedule's own answer.
    expect(currentWeekOf(games, 5, 6)).toBe(5)
    expect(currentWeekOf(games, null, 6)).toBe(6)
    expect(currentWeekOf([], null, null)).toBeNull()

    const sched = scheduleRows('ATL', 'RB', live, splits, 10)
    const liveLines: ProfileStatLine[] = [{ season: 2026, week: 5, is_live: true, rush_attempts: 9, rush_yards: 41, receptions: 1, receiving_yards: 6 }]
    const c = gameCards({ team: 'ATL', schedule: sched, games: live, weekly: [{ week: 5, points: null, proj: 16.03 }], lines: liveLines, position: 'RB', currentWeek: 5 })
    const wk5 = c.find((x) => x.week === 5)!
    // No clock or score on record: plain "Live", never an invented 0-0.
    expect(wk5).toMatchObject({ current: true, pill: 'current', mainLabel: 'Projected', main: '16.0', sub: { label: 'Game', value: 'Live' } })
    expect(wk5.line).toBe('9 car 41 yds · 1 rec 6 yds')
    expect(c.find((x) => x.week === 6)).toMatchObject({ current: false, pill: 'upcoming' })
    // His game is over but the week is not: still this week, no points yet under the scoring.
    const done = gameCards({
      team: 'ATL',
      schedule: sched,
      games: [game(5, 'ATL', 'NO', 'final')],
      weekly: [],
      lines: [{ ...liveLines[0]!, is_live: false }],
      position: 'RB',
      currentWeek: 5,
    }).find((x) => x.week === 5)!
    expect(done).toMatchObject({ pill: 'current', mainLabel: 'Projected', sub: { label: 'Game', value: 'Final' } })
  })

  it("this week's card says where his game stands: clock and score, then the result (gap list §3 #19)", () => {
    const sched = scheduleRows('ATL', 'RB', [game(4, 'LV', 'ATL', 'final'), game(5, 'NO', 'ATL', 'live'), game(6, 'ATL', 'PHI', 'scheduled')], splits, 10)
    const card = (g: TeamGame, week = 5) =>
      gameCards({ team: 'ATL', schedule: sched, games: [g], weekly: [{ week: 5, points: null, proj: 16.03 }], lines: [], position: 'RB', currentWeek: week }).find(
        (x) => x.week === 5,
      )!
    // Live, away at NO: his team's score first.
    const live = game(5, 'NO', 'ATL', 'live', undefined, { quarter: 4, game_clock: '2:00', home_score: 7, away_score: 31 })
    expect(card(live)).toMatchObject({ pill: 'current', mainLabel: 'Projected', main: '16.0', sub: { label: 'Game', value: 'Q4 2:00 · 31-7' } })
    expect(card({ ...live, quarter: 5, game_clock: '8:41', home_score: 31 }).sub).toEqual({ label: 'Game', value: 'OT 8:41 · 31-31' })
    // Over, the week not scored yet: the result.
    const final = game(5, 'NO', 'ATL', 'final', undefined, { quarter: null, game_clock: null, home_score: 20, away_score: 31 })
    expect(card(final).sub).toEqual({ label: 'Game', value: 'Final W 31-20' })
    expect(card({ ...final, home_score: 34 }).sub).toEqual({ label: 'Game', value: 'Final L 31-34' })
    // Not yet kicked off: the kickoff, as before.
    expect(card(game(5, 'NO', 'ATL', 'scheduled'), 5).sub?.label).toBe('Kickoff')
  })

  it("this week's card on the row the sync writes: plain Live / Final, never the 0-0 default", () => {
    const sched = scheduleRows('ATL', 'RB', [game(4, 'LV', 'ATL', 'final'), game(5, 'NO', 'ATL', 'live'), game(6, 'ATL', 'PHI', 'scheduled')], splits, 10)
    const card = (g: TeamGame) =>
      gameCards({ team: 'ATL', schedule: sched, games: [g], weekly: [{ week: 5, points: null, proj: 16.03 }], lines: [], position: 'RB', currentWeek: 5 }).find(
        (x) => x.week === 5,
      )!
    // Status only; home_score/away_score at 001's 0 default; no quarter or clock.
    const synced = { quarter: null, game_clock: null, home_score: 0, away_score: 0 }
    expect(card(game(5, 'NO', 'ATL', 'live', undefined, synced))).toMatchObject({ pill: 'current', sub: { label: 'Game', value: 'Live' } })
    expect(card(game(5, 'NO', 'ATL', 'final', undefined, synced))).toMatchObject({ pill: 'current', sub: { label: 'Game', value: 'Final' } })
  })

  it('opens with the week before the current one at the gutter', () => {
    expect(initialCardIndex(cards)).toBe(cards.findIndex((c) => c.week === 5))
    expect(initialCardIndex([])).toBe(0)
  })

  it('stat lines per position', () => {
    expect(statLine('QB', { season: 2026, week: 1, is_live: false, pass_completions: 22, pass_attempts: 34, pass_yards: 278, pass_tds: 2 })).toBe(
      '22/34 · 278 yds · 2 TD',
    )
    expect(statLine('WR', { season: 2026, week: 1, is_live: false, receptions: 3, targets: 6, receiving_yards: 42, receiving_tds: 1 })).toBe(
      '3/6 rec · 42 yds · 1 TD',
    )
    expect(statLine('K', { season: 2026, week: 1, is_live: false, fg_made: 1, fg_attempted: 2, xp_made: 3 })).toBe('1/2 FG · 3 XP')
    expect(statLine('DEF', { season: 2026, week: 1, is_live: false, def_sacks: 3, def_points_allowed: 20 })).toBe('3 sacks · 20 PA')
    expect(statLine('RB', undefined)).toBeNull()
  })
})

describe('game log + career tables', () => {
  const games = [game(1, 'ATL', 'CAR', 'final'), game(2, 'LV', 'ATL', 'scheduled')]
  // A full 32-defense split: CAR the most generous (rank 1 → OPRK 32nd, easy),
  // LV the stingiest (rank 32 → OPRK 1st, hard).
  const splits32 = Array.from({ length: 32 }, (_, i) => ({ defense: i === 0 ? 'CAR' : i === 31 ? 'LV' : `D${i}`, position: 'RB', rank: i + 1 }))
  const schedule = scheduleRows('ATL', 'RB', games, splits32, 3)
  const lines: ProfileStatLine[] = [
    { season: 2026, week: 1, is_live: false, rush_attempts: 20, rush_yards: 100, rush_tds: 1, targets: 4, receptions: 3, receiving_yards: 20, receiving_tds: 0 },
    { season: 2025, week: 1, is_live: false, rush_attempts: 10, rush_yards: 50, rush_tds: 0, receptions: 2, receiving_yards: 10 },
    { season: 2025, week: 2, is_live: false, rush_attempts: 12, rush_yards: 60, rush_tds: 1 },
  ]

  it('current season follows the schedule; Fpts from core weekly, tinted by the position baseline', () => {
    const t = gameLogTable({ season: 2026, current: true, position: 'RB', lines, schedule, weekly: [{ week: 1, points: 22 }], rules: STANDARD_SCORING })
    expect(t.groups).toEqual([
      { label: 'Fantasy', cols: 1 },
      { label: 'Rushing', cols: 3 },
      { label: 'Receiving', cols: 4 },
    ])
    expect(t.cols).toEqual(['Fpts', 'Att', 'Yds', 'TD', 'Tgt', 'Rec', 'Yds', 'TD'])
    const [w1, w2, w3] = t.rows
    expect(w1).toMatchObject({ k1: '1', k2: 'CAR', k2Tone: 'positive' })
    expect(w1!.cells[0]).toEqual({ value: '22.00', kind: 'good' })
    expect(w1!.cells.slice(1).map((c) => c.value)).toEqual(['20', '100', '1', '4', '3', '20', '0'])
    expect(w2).toMatchObject({ k2: '@LV', k2Tone: 'negative' })
    expect(w2!.cells.every((c) => c.kind === 'dash')).toBe(true)
    expect(w3).toMatchObject({ k2: 'Bye', k2Tone: 'muted' })
    expect(w3!.cells.every((c) => c.kind === 'bye')).toBe(true)
  })

  it('a past season lists weeks 1–18 from its lines, scored under the preset rules', () => {
    const t = gameLogTable({ season: 2025, current: false, position: 'RB', lines, schedule: [], weekly: [], rules: PPR_SCORING })
    expect(t.rows).toHaveLength(18)
    expect(t.rows[0]!.cells[0]!.value).toBe('8.00') // 5 + 1 (10 rec yds) + 2 rec
    expect(t.rows[2]!.cells.every((c) => c.kind === 'dash')).toBe(true)
    expect(fptsTone(15.6, 'RB')).toBe('good')
    expect(fptsTone(9, 'RB')).toBe('bad')
  })

  it('career: current season from core-stats, earlier seasons summed; team known for this season only', () => {
    const t = careerTable({ currentSeason: 2026, position: 'RB', team: 'ATL', lines, core: core({ games: 1, total_points: 22 }), rules: STANDARD_SCORING })
    expect(t.cols.slice(0, 4)).toEqual(['Gm', 'Fpts', 'Std', 'PPR'])
    expect(t.groups.slice(0, 2)).toEqual([
      { label: 'Fantasy', cols: 2 },
      { label: 'Position rank', cols: 2 },
    ])
    expect(t.rows.map((r) => [r.k1, r.k2])).toEqual([
      ['2026', 'ATL'],
      ['2025', '–'],
    ])
    // Ranks unread: plain Fpts, dash ranks.
    expect(t.rows[0]!.cells.slice(0, 4)).toEqual([
      { value: '1', kind: 'plain' },
      { value: '22.0', kind: 'plain' },
      { value: '–', kind: 'dash' },
      { value: '–', kind: 'dash' },
    ])
    expect(t.rows[1]!.cells.slice(0, 7).map((c) => c.value)).toEqual(['2', '18.0', '–', '–', '22', '110', '1'])
  })

  it('career: this season’s Std / PPR ranks, tinted, and Fpts tinted by the Std rank; past seasons unranked', () => {
    const t = careerTable({
      currentSeason: 2026,
      position: 'RB',
      team: 'ATL',
      lines,
      core: core({ games: 1, total_points: 22 }),
      rules: STANDARD_SCORING,
      ranks: { std: 8, ppr: 14 },
    })
    expect(t.rows[0]!.cells.slice(1, 4)).toEqual([
      { value: '22.0', kind: 'good' },
      { value: '8', kind: 'good' },
      { value: '14', kind: 'mid' },
    ])
    expect(t.rows[1]!.cells.slice(1, 4).map((c) => c.kind)).toEqual(['plain', 'dash', 'dash'])
    expect([rankTone(12), rankTone(13), rankTone(23), rankTone(24)]).toEqual(['good', 'mid', 'mid', 'bad'])
  })

  it('past seasons score under the basis preset (league → standard)', () => {
    expect(pastSeasonRules({ kind: 'system', system: 'ppr' })).toBe(PPR_SCORING)
    expect(pastSeasonRules({ kind: 'system', system: 'quarter_ppr' })).toBe(QUARTER_PPR_SCORING)
    expect(pastSeasonRules({ kind: 'league', leagueId: 'L' })).toBe(STANDARD_SCORING)
  })
})

describe('key stats trend', () => {
  const wk = (week: number, over: Partial<ProfileStatLine>): ProfileStatLine => ({ season: 2026, week, is_live: false, ...over })
  const lines: ProfileStatLine[] = [
    wk(1, { rush_attempts: 10, rush_yards: 40, targets: 2, receptions: 1, pass_attempts: 0 }),
    wk(2, { rush_attempts: 10, rush_yards: 40, targets: 2, receptions: 1 }),
    wk(3, { rush_attempts: 20, rush_yards: 100, targets: 2, receptions: 1 }),
    wk(4, { rush_attempts: 20, rush_yards: 100, targets: 2, receptions: 1 }),
    wk(5, { rush_attempts: 20, rush_yards: 100, targets: 2, receptions: 1 }),
    // A live week and an unscored week never count.
    wk(6, { rush_attempts: 30, rush_yards: 300, is_live: true }),
  ]
  const completed = new Set([1, 2, 3, 4, 5])

  it('last three completed games against the season, per game, one decimal', () => {
    const t = keyStatTrends({ lines, season: 2026, completedWeeks: completed })
    // Rush yds/gm: season 76, last 3 100 → ▲ 24.0. Carries: 16 → 20 → ▲ 4.0.
    expect(t.rush_yds).toEqual({ up: true, good: true, text: '▲ last 3 24.0' })
    expect(t.carries_pg).toEqual({ up: true, good: true, text: '▲ last 3 4.0' })
    // Targets flat → no direction, no line.
    expect(t.targets).toBeUndefined()
    // No weekly source (season usage rows) → never a trend.
    expect(t.snap_pct).toBeUndefined()
  })

  it('a percentage trends in whole points; three games or fewer is the whole season (no trend)', () => {
    const qb = [1, 2, 3, 4].map((w) => wk(w, w === 1 ? { pass_attempts: 30, pass_completions: 15 } : { pass_attempts: 30, pass_completions: 21 }))
    // Season 78/120 = 65%, last 3 63/90 = 70% → ▲ 5%.
    expect(keyStatTrends({ lines: qb, season: 2026, completedWeeks: new Set([1, 2, 3, 4]) }).comp_pct).toEqual({ up: true, good: true, text: '▲ last 3 5%' })
    expect(keyStatTrends({ lines: qb, season: 2026, completedWeeks: new Set([1, 2, 3]) })).toEqual({})
  })

  it('coloured by better or worse (#43): fewer interceptions is ▼ green, more is ▲ red', () => {
    const qb = (ints: number[]) => ints.map((n, i) => wk(i + 1, { pass_attempts: 30, pass_completions: 20, interceptions: n }))
    const weeks = new Set([1, 2, 3, 4, 5])
    // Season 6 INT / 5 = 1.2 per game, last 3 0 → ▼ 1.2, a GOOD trend.
    expect(keyStatTrends({ lines: qb([3, 3, 0, 0, 0]), season: 2026, completedWeeks: weeks }).int).toEqual({ up: false, good: true, text: '▼ last 3 1.2' })
    // Season 6 / 5 = 1.2, last 3 2.0 → ▲ 0.8, a BAD trend.
    expect(keyStatTrends({ lines: qb([0, 0, 2, 2, 2]), season: 2026, completedWeeks: weeks }).int).toEqual({ up: true, good: false, text: '▲ last 3 0.8' })
    // A production stat falling is ▼ red.
    const rb = [40, 40, 10, 10, 10].map((y, i) => wk(i + 1, { rush_yards: y }))
    expect(keyStatTrends({ lines: rb, season: 2026, completedWeeks: weeks }).rush_yds).toMatchObject({ up: false, good: false })
  })

  it('a defense: points / yards allowed falling is green; its own sacks and takeaways rising is green', () => {
    const def = [
      { def_points_allowed: 30, def_yards_allowed: 400, def_sacks: 1, def_interceptions: 0 },
      { def_points_allowed: 30, def_yards_allowed: 400, def_sacks: 1, def_interceptions: 0 },
      { def_points_allowed: 10, def_yards_allowed: 250, def_sacks: 4, def_interceptions: 2 },
      { def_points_allowed: 10, def_yards_allowed: 250, def_sacks: 4, def_interceptions: 2 },
      { def_points_allowed: 10, def_yards_allowed: 250, def_sacks: 4, def_interceptions: 2 },
    ].map((l, i) => wk(i + 1, l))
    const t = keyStatTrends({ lines: def, season: 2026, completedWeeks: new Set([1, 2, 3, 4, 5]) })
    expect(t.pa_pg).toMatchObject({ up: false, good: true })
    expect(t.ya_pg).toMatchObject({ up: false, good: true })
    expect(t.sacks).toMatchObject({ up: true, good: true })
    expect(t.def_int).toMatchObject({ up: true, good: true })
  })

  it('the better-or-worse map: lower is better only for interceptions thrown and yards / points allowed', () => {
    const lower = Object.entries(TREND_BETTER)
      .filter(([, b]) => b === 'lower')
      .map(([k]) => k)
      .sort()
    expect(lower).toEqual(['int', 'pa_pg', 'ya_pg'])
    expect(trendIsGood('int', false)).toBe(true)
    expect(trendIsGood('int', true)).toBe(false)
    expect(trendIsGood('rec_yds', true)).toBe(true)
    expect(trendIsGood('rec_yds', false)).toBe(false)
  })
})

describe('depth chart', () => {
  const p = (id: string, full: string, pos: string, slot: string, order: number): DepthChartPlayer => ({
    id,
    full_name: full,
    first_name: full.split(' ')[0]!,
    last_name: full.split(' ').slice(1).join(' '),
    position: pos,
    birth_date: '2000-01-01',
    depth_chart_position: slot,
    depth_chart_order: order,
  })
  const today = new Date('2026-10-15T12:00:00Z')

  it('QB · RB · WR1–3 · TE · K, three deep by order, self highlighted', () => {
    const rows = depthChart(
      [
        p('q2', 'Kirk Cousins', 'QB', 'QB', 2),
        p('q1', 'Michael Penix Jr.', 'QB', 'QB', 1),
        p('p1', 'Bijan Robinson', 'RB', 'RB', 1),
        p('w1', 'Drake London', 'WR', 'LWR', 1),
        p('w3', 'Ray-Ray McCloud', 'WR', 'SWR', 1),
        p('k1', 'Younghoe Koo', 'K', 'K', 1),
      ],
      'p1',
      today,
    )
    expect(rows.map((r) => r.slot)).toEqual(['QB', 'RB', 'WR1', 'WR3', 'K'])
    expect(rows[0]!.cells[0]).toMatchObject({ first: 'Michael · 26', last: 'Penix Jr.', name: 'Michael Penix Jr.', self: false, playerId: 'q1' })
    expect(rows[0]!.cells[2]).toBeNull()
    expect(rows[1]!.cells[0]!.self).toBe(true)
  })

  it('a feed with plain WR slots gets one WR row', () => {
    const rows = depthChart([p('w1', 'A B', 'WR', 'WR', 1), p('w2', 'C D', 'WR', 'WR', 2)], 'x', today)
    expect(rows.map((r) => r.slot)).toEqual(['WR'])
    expect(rows[0]!.cells.filter(Boolean)).toHaveLength(2)
  })
})

describe('moves', () => {
  const teams: LeagueDetail['teams'] = [
    { id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', created_at: null },
    { id: 't2', name: 'Gridiron Gurus', owner_id: 'u2', status: 'active', created_at: null },
  ]
  const members = [
    { id: 'm1', user_id: 'u1', team_id: 't1', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
    { id: 'm2', user_id: 'u2', team_id: 't2', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
  ] as LeagueDetail['members']
  const tx = (id: string, type: string, payload: unknown, at: string, team = 't1'): ActivityItem => ({
    kind: 'transaction',
    id,
    created_at: at,
    type,
    status: 'complete',
    week: 3,
    team_id: team,
    actor_id: null,
    action_id: null,
    payload: payload as never,
  })
  const pick: DraftPickSummary = {
    id: 'pk',
    pick_number: 5,
    round: 1,
    team_id: 't2',
    player_id: 'p1',
    is_auto: false,
    is_undone: false,
    price: null,
    made_via: null,
    created_at: '2026-08-30T00:00:00Z',
  }

  it('adds, drops, claims, trades and the draft pick — newest first', () => {
    const moves = playerMoves({
      playerId: 'p1',
      items: [
        tx('a', 'add_drop', { add: { player_id: 'p1', name: 'B' }, drop: { player_id: 'x', name: 'X' } }, '2026-10-11T00:00:00Z'),
        tx('b', 'waiver_claim', { add_player_id: 'p1', faab_bid: 11, faab_before: 90 }, '2026-10-01T00:00:00Z'),
        tx('c', 'add_drop', { drop: { player_id: 'p1', name: 'B' } }, '2026-09-20T00:00:00Z', 't2'),
        tx('d', 'trade', { players: [{ player_id: 'p1', to_team_id: 't1', from_team_id: 't2' }] }, '2026-09-10T00:00:00Z'),
        tx('e', 'add_drop', { add: { player_id: 'other', name: 'O' } }, '2026-10-12T00:00:00Z'),
      ],
      picks: [pick],
      teams,
      members,
    })
    expect(moves.map((m) => [m.kind, m.lead, m.username ?? m.team, m.detail])).toEqual([
      ['Added', 'by ', 'dalton', ' · free agent'],
      ['Added', 'by ', 'dalton', ' · waiver $11'],
      ['Dropped', 'by ', 'Gridiron Gurus', ''],
      ['Traded', 'to ', 'dalton', ' · trade'],
      ['Drafted', 'by ', 'Gridiron Gurus', ' in round 1'],
    ])
  })

  it('an auction pick names its price; an undone pick is not his', () => {
    expect(playerMoves({ playerId: 'p1', items: [], picks: [{ ...pick, price: 59 }], teams, members })[0]!.detail).toBe(' for $59')
    expect(playerMoves({ playerId: 'p1', items: [], picks: [{ ...pick, is_undone: true }], teams, members })).toEqual([])
  })
})

describe('transactions timeline (#46)', () => {
  const mv = (id: string, at: string | null, kind: ProfileMove['kind'] = 'Added'): ProfileMove => ({
    id,
    kind,
    lead: 'by ',
    username: null,
    team: 'Tacos',
    detail: '',
    at,
  })

  it('one timeline across leagues, newest first, each move naming its league', () => {
    const out = movesTimeline([
      { leagueId: 'L1', leagueName: 'Sunday Funday', moves: [mv('a', '2026-10-11T00:00:00Z'), mv('b', '2026-09-01T00:00:00Z', 'Drafted')] },
      { leagueId: 'L2', leagueName: 'Work League', moves: [mv('a', '2026-10-12T09:00:00+00:00', 'Dropped'), mv('c', '2026-09-20T00:00:00Z')] },
    ])
    expect(out.map((m) => [m.leagueName, m.id, m.kind])).toEqual([
      ['Work League', 'a', 'Dropped'],
      ['Sunday Funday', 'a', 'Added'],
      ['Work League', 'c', 'Added'],
      ['Sunday Funday', 'b', 'Drafted'],
    ])
    // The same move id in two leagues stays two rows.
    expect(new Set(out.map((m) => m.key)).size).toBe(4)
    expect(out[0]).toMatchObject({ key: 'L2:a', leagueId: 'L2' })
  })

  it('compares instants, not strings; a move with no instant goes last; ties keep league order', () => {
    const out = movesTimeline([
      { leagueId: 'L1', leagueName: 'One', moves: [mv('x', null), mv('t1', '2026-10-01T12:00:00Z')] },
      // 08:00 at -05:00 is 13:00Z — later than 12:00Z although it sorts earlier as text.
      { leagueId: 'L2', leagueName: 'Two', moves: [mv('t2', '2026-10-01T08:00:00-05:00'), mv('t3', '2026-10-01T12:00:00.000Z')] },
    ])
    expect(out.map((m) => m.key)).toEqual(['L2:t2', 'L1:t1', 'L2:t3', 'L1:x'])
  })

  it('no moves anywhere → an empty timeline', () => {
    expect(movesTimeline([])).toEqual([])
    expect(movesTimeline([{ leagueId: 'L1', leagueName: 'One', moves: [] }])).toEqual([])
  })
})

describe('ownership row (#44)', () => {
  it('per league: pre-draft until it drafts (and while his pick is still to come), then rostered or not', () => {
    expect(leagueOwnership('setup', 't1', null)).toBe('pre_draft')
    expect(leagueOwnership('scheduled', 't1', null)).toBe('pre_draft')
    expect(leagueOwnership('drafting', 't1', false)).toBe('pre_draft')
    expect(leagueOwnership('drafting', 't1', true)).toBe('rostered')
    expect(leagueOwnership('in_season', 't1', true)).toBe('rostered')
    expect(leagueOwnership('in_season', 't1', false)).toBe('available')
    expect(leagueOwnership('playoffs', 't1', false)).toBe('available')
    expect(leagueOwnership('playoffs', null, false)).toBe('no_team')
    expect(leagueOwnership('complete', 't1', true)).toBe('rostered')
    expect(leagueOwnership('complete', 't1', false)).toBe('season_over')
  })

  it('only a league that has not drafted skips the rosters read', () => {
    expect(['setup', 'scheduled'].map(ownershipNeedsRosters)).toEqual([false, false])
    expect(['drafting', 'in_season', 'playoffs', 'complete'].map(ownershipNeedsRosters)).toEqual([true, true, true, true])
  })

  it('the summary never says "Not available"', () => {
    expect(ownershipSummary(['available'])).toBe('Available in 1 league')
    expect(ownershipSummary(['available', 'rostered', 'available', 'pre_draft'])).toBe('Available in 2 leagues')
    expect(ownershipSummary(['rostered'])).toBe('Rostered in all your leagues')
    expect(ownershipSummary(['rostered', 'rostered', 'rostered'])).toBe('Rostered in all your leagues')
    expect(ownershipSummary(['pre_draft', 'pre_draft'])).toBe('Pre-draft')
    expect(ownershipSummary(['rostered', 'pre_draft', 'rostered'])).toBe('Rostered in 2 · Pre-draft in 1')
    expect(ownershipSummary(['season_over', 'season_over'])).toBe('Season over')
    expect(ownershipSummary(['rostered', 'season_over', 'no_team'])).toBe('Rostered in 1 · Season over in 1 · No team in 1')
    for (const states of [['rostered'], ['pre_draft'], ['rostered', 'pre_draft'], ['season_over'], ['no_team']] as const) {
      expect(ownershipSummary(states)).not.toMatch(/not available/i)
    }
  })

  it('still reading, or a read failed: says so rather than a count', () => {
    expect(ownershipSummary(['rostered', 'loading'])).toBe('Checking…')
    expect(ownershipSummary(['available', 'error'])).toBe('Couldn’t check every league')
    expect(ownershipSummary([])).toBe('')
  })
})

describe('league copy', () => {
  it('waiver clear day', () => {
    expect(clearsDay('not a date')).toBeNull()
    expect(clearsDay('2026-10-14T16:00:00Z')).toMatch(/^clears (Mon|Tue|Wed|Thu)$/)
  })
})
