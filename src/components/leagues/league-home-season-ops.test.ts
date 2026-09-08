/**
 * league-home-season-ops.test.ts — every decision the season heroes make,
 * pinned pure (spec §16.5.1 in_season/playoffs/complete rows, §16.5.3,
 * §16.5.4; PROGRESS F46, D324). The DoD probe: point `heroWeek` at week 1
 * unconditionally → the current-week cell here AND the render suite's
 * matchup-of-the-week cell go red.
 */
import { describe, expect, it } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import * as ops from './league-home-season-ops'
import {
  CHAMPION_UNRECORDED_COPY,
  LINEUP_NOT_SET_COPY,
  LINEUP_NO_RECORD_COPY,
  LINEUP_READING_COPY,
  championName,
  draftDoors,
  heroMatchup,
  heroWeek,
  leagueNav,
  scoringLive,
  setLineupCopy,
  standingsPeek,
  tradeChip,
  waiverChip,
  waiverTypeLabel,
} from './league-home-season-ops'
import { GOLDEN_STANDINGS } from './standings-schedule.fixtures'

const T1 = 't1'
const T2 = 't2'
const T3 = 't3'
const T4 = 't4'

function row(over: Partial<MatchupRow> & Pick<MatchupRow, 'id' | 'home_team_id' | 'away_team_id'>): MatchupRow {
  return { season: 2099, week: 2, round_type: 'regular', status: 'live', home_score: null, away_score: null, result: null, is_overridden: false, updated_at: null, ...over }
}

// ---------------------------------------------------------------------------
// The week — the ladder's current week, never a literal (the DoD probe)
// ---------------------------------------------------------------------------

describe('heroWeek — the ladder’s CURRENT week (D316(2)), never week 1 by habit', () => {
  const ladder = [
    { week: 1, status: 'final' },
    { week: 2, status: 'live' },
    { week: 3, status: 'upcoming' },
  ]
  it('the greatest started week', () => {
    expect(heroWeek(ladder)).toBe(2)
  })
  it('the first week when nothing has started; null with no ladder', () => {
    expect(heroWeek([{ week: 4, status: 'upcoming' }, { week: 5, status: 'upcoming' }])).toBe(4)
    expect(heroWeek([])).toBeNull()
    expect(heroWeek(undefined)).toBeNull()
  })
  it('a season deep in December: week 14 live over 13 finals', () => {
    const late = Array.from({ length: 14 }, (_, i) => ({ week: i + 1, status: i + 1 === 14 ? 'live' : 'final' }))
    expect(heroWeek(late)).toBe(14)
  })
})

// ---------------------------------------------------------------------------
// The viewer's matchup — strictly theirs
// ---------------------------------------------------------------------------

describe('heroMatchup — the viewer’s own primary row, or the reason there is none', () => {
  const rows = [row({ id: 'm1', home_team_id: T1, away_team_id: T2 }), row({ id: 'm2', home_team_id: T3, away_team_id: T4 })]
  it('mine — home or away', () => {
    expect(heroMatchup(rows, T1)).toEqual({ kind: 'mine', row: rows[0] })
    expect(heroMatchup(rows, T4)).toEqual({ kind: 'mine', row: rows[1] })
  })
  it('a stranger’s row is NEVER the hero — none_for_team, not the first row', () => {
    expect(heroMatchup(rows, 't9')).toEqual({ kind: 'none_for_team' })
  })
  it('no seat (a commissioner without a franchise) · no rows (a playoff week before its round)', () => {
    expect(heroMatchup(rows, null)).toEqual({ kind: 'no_seat' })
    expect(heroMatchup([], T1)).toEqual({ kind: 'no_rows' })
  })
  it('a secondary (second-opponent) row never stands in for the primary', () => {
    const secondary = row({ id: 's1', home_team_id: T1, away_team_id: T3, round_type: 'secondary' })
    expect(heroMatchup([secondary], T1)).toEqual({ kind: 'no_rows' })
    expect(heroMatchup([secondary, rows[0]], T1)).toEqual({ kind: 'mine', row: rows[0] })
  })
  it('a bye row (away NULL) is still mine', () => {
    const bye = row({ id: 'b1', home_team_id: T1, away_team_id: null })
    expect(heroMatchup([bye], T1)).toEqual({ kind: 'mine', row: bye })
  })
})

// ---------------------------------------------------------------------------
// Set lineup — the RECORD, never a countdown (Q40 open)
// ---------------------------------------------------------------------------

describe('setLineupCopy — "Locks from <stored instant>", no countdown while Q40 is open', () => {
  it('reading · nothing set · no record · the record', () => {
    expect(setLineupCopy(undefined, null)).toBe(LINEUP_READING_COPY)
    expect(setLineupCopy(null, null)).toBe(LINEUP_NOT_SET_COPY)
    expect(setLineupCopy({ locked_at: null }, null)).toBe(LINEUP_NO_RECORD_COPY)
    expect(setLineupCopy({ locked_at: '2099-09-13T17:00:00Z' }, 'Sun 1:00 PM')).toBe('Locks from Sun 1:00 PM')
  })
  it('never a countdown word, never a ledger code', () => {
    for (const copy of [LINEUP_READING_COPY, LINEUP_NOT_SET_COPY, LINEUP_NO_RECORD_COPY, setLineupCopy({ locked_at: 'x' }, 'Sun 1:00 PM')]) {
      expect(copy).not.toMatch(/countdown|\d+:\d+:\d+|\b[QEF]\d+\b/)
    }
  })
})

// ---------------------------------------------------------------------------
// The standings peek — a slice of 117's order
// ---------------------------------------------------------------------------

describe('standingsPeek — a SLICE of 117’s ranked rows, the reason carried through, nothing re-sorted', () => {
  it('top 4 in stored order; the viewer inside the top adds no row', () => {
    const peek = standingsPeek(GOLDEN_STANDINGS, 't2')
    expect(peek.rows.map((r) => r.team_id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(peek.elided).toBe(false)
    expect(peek.weeksFinal).toBe(3)
    expect(peek.reason).toBe(GOLDEN_STANDINGS.reason)
  })
  it('the viewer below the slice is appended; a gap of more than one row is marked elided', () => {
    const doc = {
      ...GOLDEN_STANDINGS,
      standings: [
        ...GOLDEN_STANDINGS.standings,
        { ...GOLDEN_STANDINGS.standings[3], rank: 5, team_id: 't5', name: 'Echo' },
        { ...GOLDEN_STANDINGS.standings[3], rank: 6, team_id: 't6', name: 'Foxtrot' },
      ],
    }
    const five = standingsPeek(doc, 't5', 4)
    expect(five.rows.map((r) => r.team_id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(five.elided).toBe(false)
    const six = standingsPeek(doc, 't6', 4)
    expect(six.rows.map((r) => r.team_id)).toEqual(['t1', 't2', 't3', 't4', 't6'])
    expect(six.elided).toBe(true)
  })
  it('a stored 0 is a stored 0 — the peek papers over nothing; 117’s reason is what says "nothing final"', () => {
    const zeros = {
      ...GOLDEN_STANDINGS,
      weeks_final: 0,
      reason: 'no_final_weeks',
      standings: GOLDEN_STANDINGS.standings.map((r) => ({ ...r, wins: 0, losses: 0, points_for: 0, points_against: 0, win_pct: 0 })),
    }
    const peek = standingsPeek(zeros, null)
    expect(peek.rows.every((r) => r.points_for === 0)).toBe(true)
    expect(peek.reason).toBe('no_final_weeks')
    expect(peek.weeksFinal).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The honest chips
// ---------------------------------------------------------------------------

describe('the waiver / trade chips print the STORED settings and name the verbs as not yet here', () => {
  const settings = defaultsForTeamCount(8)
  it('waivers: the period from the settings; no run day/time printed as a deadline no job keeps', () => {
    const chip = waiverChip(settings)
    expect(chip.label).toBe(`Waivers · dropped players clear after ${settings.waiver_period_hours} h`)
    expect(chip.title).toContain('Waiver claims arrive in a later update.')
    expect(chip.title).toContain(waiverTypeLabel(settings.waiver_type))
    expect(chip.label + chip.title).not.toMatch(/Tue|Wed|Thu|\d{1,2}:\d{2}/)
  })
  it('waivers off (none_fcfs): says so', () => {
    const chip = waiverChip({ ...settings, waiver_type: 'none_fcfs' })
    expect(chip.label).toMatch(/No waivers/)
    expect(chip.title).toContain('first come, first served')
  })
  it('trades: the stored deadline week, or none — no "passed" judgement', () => {
    expect(tradeChip({ trade_deadline_week: 11 })).toEqual({ label: 'Trade deadline · Week 11', title: 'Trades close after Week 11. Trades arrive in a later update.' })
    expect(tradeChip({ trade_deadline_week: null }).label).toBe('No trade deadline')
    expect(tradeChip({ trade_deadline_week: 11 }).title).not.toMatch(/passed|closed already/)
  })
})

// ---------------------------------------------------------------------------
// complete — the stored champion
// ---------------------------------------------------------------------------

describe('championName — leagues.champion_team_id, stored; the honest absence', () => {
  const detail = {
    league: { champion_team_id: 't2' } as LeagueDetail['league'],
    teams: [
      { id: 't1', name: 'Alpha' },
      { id: 't2', name: 'Bravo' },
    ] as LeagueDetail['teams'],
  }
  it('resolves the id to a team name', () => {
    expect(championName(detail)).toBe('Bravo')
  })
  it('null when unwritten or unknown — never rank 1 of the standings by inference', () => {
    expect(championName({ ...detail, league: { champion_team_id: null } as LeagueDetail['league'] })).toBeNull()
    expect(championName({ ...detail, league: { champion_team_id: 't9' } as LeagueDetail['league'] })).toBeNull()
    expect(CHAMPION_UNRECORDED_COPY).toMatch(/No champion recorded/)
  })
})

// ---------------------------------------------------------------------------
// Doors + nav (F46 / R281 · F251(c) / F253(c) / F275(c))
// ---------------------------------------------------------------------------

describe('the nav and the two post-draft doors', () => {
  it('nav: my team first when seated, then matchups · standings · schedule · players', () => {
    expect(leagueNav('L', 'T').map((i) => i.href)).toEqual([
      '/app/leagues/L/team/T',
      '/app/leagues/L/matchup',
      '/app/leagues/L/standings',
      '/app/leagues/L/schedule',
      '/app/leagues/L/players',
    ])
    expect(leagueNav('L', null).map((i) => i.key)).toEqual(['matchups', 'standings', 'schedule', 'players'])
  })
  it('doors: the recap route and the launcher SEAM (`?practice=1` — mock-launcher-entry’s printed destination)', () => {
    expect(draftDoors('L')).toEqual({ recap: '/app/leagues/L/draft/recap', practice: '/app/leagues/L/draft?practice=1' })
  })
})

describe('scoringLive — the stats_degraded poll asks only while a week is scoring (F277(d) / F274)', () => {
  it('live · correction_window ask; upcoming · final do not; unknown asks (conservative)', () => {
    expect(scoringLive('live')).toBe(true)
    expect(scoringLive('correction_window')).toBe(true)
    expect(scoringLive('upcoming')).toBe(false)
    expect(scoringLive('final')).toBe(false)
    expect(scoringLive(null)).toBe(true)
    expect(scoringLive(undefined)).toBe(true)
  })
})

describe('no ledger code in any end-user copy (F277(a))', () => {
  it('every exported string constant is free of Q/E/F/D/R numbers', () => {
    for (const [name, value] of Object.entries(ops)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
    }
  })
})
