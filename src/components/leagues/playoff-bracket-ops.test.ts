/**
 * playoff-bracket-ops.test.ts — L.D5.5's pure pins (spec §16.2
 * `playoff-bracket`, §11.5's Playoffs bullet v2.16.25 — Q39 (A)–(E), §16.4's
 * timezone rule; PROGRESS D318, D326).
 *
 * THE DoD PROBE lives here: **the rollover copy pin.** `rollover_at` is ONE
 * absolute instant per league; the fixture renders it in THREE named viewer
 * zones and asserts each reads the viewer's own clock (12:00 AM in Los
 * Angeles, 2:00 AM in Chicago, 3:00 AM in New York — Chris: "for central
 * and eastern timezones it's already hours into Tuesday") with the league
 * zone on hover, and that the word "midnight" never appears. Rendering the
 * instant through a FIXED zone reds the CT/ET cells; rendering it as the
 * word "midnight" reds the no-midnight cell (shown in the PR, reverted).
 *
 * Every other cell LABELS 118's document: nothing here re-derives a seed,
 * a total or a verdict.
 */
import { describe, expect, it } from 'vitest'

import {
  AWAITING_BUILD_COPY,
  NO_PLAYOFFS_COPY,
  NO_PROJECTION_NO_WEEKS_COPY,
  POINTS_RACE_COPY,
  ROLLOVER_EVENT_PREFIX,
  bracketShape,
  EDIT_RESULT_LABEL,
  commishResultLinks,
  correctionsCloseDisplay,
  foreignRowsCopy,
  foreignRowsOf,
  bracketProjectionWeeks,
  bracketTotalCell,
  bracketWeekCells,
  roundWeekStatus,
  formatInstantForViewer,
  formatTotal,
  gamePlayed,
  pointsRaceCopy,
  projectionBasisCopy,
  rolloverDisplay,
  roundBadge,
  roundLabel,
  seededBeforeCorrection,
  sourceLabel,
  tbdSlots,
  teamName,
  verdictCopy,
} from './playoff-bracket-ops'
import {
  AWAITING_BUILD_DOC,
  BRACKET_NAMES,
  BUILT_DOC,
  BUILT_UNPLAYED_DOC,
  COMPLETE_DOC,
  CORRECTIONS_CLOSE_AT,
  FOREIGN_ROWS_DOC,
  NO_PLAYOFFS_DOC,
  POINTS_RACE_DOC,
  PROJECTED_DOC,
  PROJECTED_NO_WEEKS_DOC,
  PROJECTED_UNSEEDABLE_DOC,
  ROLLOVER_AT,
  T,
  UNRECORDED_ROLLOVER_DOC,
} from './playoff-bracket.fixtures'
import type { BracketGameWeek } from '@/lib/leagues/api/playoffs-service'

import { NO_PROJECTION_TITLE, PROJECTED_SCORE_TITLE, WEEK_NOT_STARTED_TITLE } from './matchup-view-ops'
import { PROJECTED_ROUND_TITLE } from './playoff-bracket-ops'

// ---------------------------------------------------------------------------
// THE ROLLOVER COPY PIN (Q39 (E) / §16.4) — the DoD probe's target
// ---------------------------------------------------------------------------

describe('the rollover is ONE absolute instant, rendered in the VIEWER’S zone — never "midnight", never a fixed clock', () => {
  const LEAGUE_ZONE = 'America/Los_Angeles'

  it('Tuesday 08:00Z reads as the viewer’s own clock: 12:00 AM in Los Angeles, 2:00 AM in Chicago, 3:00 AM in New York', () => {
    // The instant is the SAME `timestamptz` in all three — only the rendering moves.
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'America/Los_Angeles').text).toBe('Tue, Dec 15, 12:00 AM')
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'America/Chicago').text).toBe('Tue, Dec 15, 2:00 AM')
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'America/New_York').text).toBe('Tue, Dec 15, 3:00 AM')
    // …and a viewer east of UTC is already into Tuesday afternoon.
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'Europe/Berlin').text).toBe('Tue, Dec 15, 9:00 AM')
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'Asia/Tokyo').text).toBe('Tue, Dec 15, 5:00 PM')
  })

  it('the league zone rides on HOVER with its abbreviation (§16.4) — the viewer’s text does not carry it', () => {
    const chicago = rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'America/Chicago')
    expect(chicago.kind).toBe('instant')
    expect(chicago.title).toBe('Tue, Dec 15, 2099 · 12:00 AM PST (league time)')
    expect(chicago.text).not.toContain('PST')
    // No named league zone ⇒ no hover half; the viewer's text is unchanged.
    const bare = rolloverDisplay(PROJECTED_DOC, null, 'America/Chicago')
    expect(bare.title).toBeNull()
    expect(bare.text).toBe('Tue, Dec 15, 2:00 AM')
  })

  it('the word "midnight" NEVER appears — the instant IS midnight Pacific, and the copy still says the viewer’s clock', () => {
    for (const zone of ['America/Los_Angeles', 'America/Chicago', 'America/New_York', 'UTC', undefined]) {
      const d = rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, zone)
      expect(`${d.text} ${d.title ?? ''}`, String(zone)).not.toMatch(/midnight/i)
    }
    // Neither does any copy constant on this surface.
    for (const copy of [AWAITING_BUILD_COPY, POINTS_RACE_COPY, NO_PLAYOFFS_COPY, NO_PROJECTION_NO_WEEKS_COPY]) {
      expect(copy).not.toMatch(/midnight/i)
    }
  })

  it('an unrecorded rollover (`rollover_at` NULL — F238) names the EVENT, not a clock: "When Week 14’s last game ends"', () => {
    const d = rolloverDisplay(UNRECORDED_ROLLOVER_DOC, LEAGUE_ZONE, 'America/New_York')
    expect(d).toEqual({ text: `${ROLLOVER_EVENT_PREFIX} 14’s last game ends`, title: null, kind: 'event' })
    expect(d.text).not.toMatch(/\d:\d\d|\b(AM|PM)\b|midnight/i)
    // No week either (a league without a ladder yet) — still the event.
    expect(rolloverDisplay({ rollover_week: null, rollover_at: null }, LEAGUE_ZONE).text).toBe('When the last regular-season game ends')
  })

  it('the correction close renders the same way (a recorded calendar instant, viewer-local)', () => {
    const d = correctionsCloseDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'America/New_York')
    expect(d?.text).toBe('Thu, Dec 17, 6:00 AM')
    expect(d?.title).toBe('Thu, Dec 17, 2099 · 3:00 AM PST (league time)')
    expect(correctionsCloseDisplay({ corrections_close_at: null }, LEAGUE_ZONE)).toBeNull()
    expect(CORRECTIONS_CLOSE_AT).toBe('2099-12-17T11:00:00+00:00')
  })

  it('the formatter reads NO clock: the instant is the argument, and a bad one renders null (never today)', () => {
    expect(formatInstantForViewer('not-an-instant', 'UTC')).toBeNull()
    expect(formatInstantForViewer(ROLLOVER_AT, 'Not/AZone')).toBeNull()
    expect(formatInstantForViewer(ROLLOVER_AT, 'UTC')).toBe('Tue, Dec 15, 8:00 AM')
    // The unusable-zone fallback keeps the ISO literal on screen rather than nothing.
    expect(rolloverDisplay(PROJECTED_DOC, LEAGUE_ZONE, 'Not/AZone').text).toBe(ROLLOVER_AT)
  })
})

// ---------------------------------------------------------------------------
// The document's shape
// ---------------------------------------------------------------------------

describe('bracketShape — the document decides the surface', () => {
  it('projected while the regular season is in play; awaiting_build once it has rolled with nothing written; bracket once round 1 exists', () => {
    expect(bracketShape(PROJECTED_DOC)).toBe('projected')
    expect(bracketShape(AWAITING_BUILD_DOC)).toBe('awaiting_build')
    expect(bracketShape(BUILT_DOC)).toBe('bracket')
    expect(bracketShape(COMPLETE_DOC)).toBe('bracket')
  })

  it('the no-bracket kinds pass through (Q39 (C)/(D)) with their copy', () => {
    expect(bracketShape(POINTS_RACE_DOC)).toBe('points_race')
    expect(bracketShape(NO_PLAYOFFS_DOC)).toBe('no_playoffs')
    expect(pointsRaceCopy('points_race')).toBe(POINTS_RACE_COPY)
    expect(pointsRaceCopy('no_playoffs')).toBe(NO_PLAYOFFS_COPY)
  })

  it('foreign rows are COUNTED from the document (D318(5)) and said in words', () => {
    expect(foreignRowsOf(PROJECTED_DOC)).toBe(0)
    expect(foreignRowsOf(FOREIGN_ROWS_DOC)).toBe(1)
    expect(foreignRowsOf(POINTS_RACE_DOC)).toBe(0)
    expect(foreignRowsCopy(0)).toBeNull()
    expect(foreignRowsCopy(1)).toContain('1 playoff pairing on record was not written by the engine')
    expect(foreignRowsCopy(3)).toContain('3 playoff pairings on record were not written by the engine')
  })
})

describe('the projection’s basis, named (weeks final / projected / seeded)', () => {
  it('counts both halves', () => {
    expect(projectionBasisCopy(PROJECTED_DOC.projection_basis, 6)).toBe('Based on 8 weeks final and 1 projected as if it ended now.')
    expect(projectionBasisCopy({ projected: true, weeks_final: 1, weeks_projected: 2, seeded: 6, reason: null }, 6)).toBe(
      'Based on 1 week final and 2 projected as if they ended now.',
    )
  })
  it('no week played ⇒ the coin-flip copy; a table that cannot fill the bracket ⇒ says how many seats it can seed', () => {
    expect(projectionBasisCopy(PROJECTED_NO_WEEKS_DOC.projection_basis, 6)).toBe(NO_PROJECTION_NO_WEEKS_COPY)
    expect(projectionBasisCopy(PROJECTED_UNSEEDABLE_DOC.projection_basis, 6)).toBe(
      'Only 3 of 6 seats can be seeded yet — the projection appears once the standings can fill the bracket.',
    )
    expect(projectionBasisCopy(null, 6)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Rounds and games — 118's words, labelled
// ---------------------------------------------------------------------------

describe('rounds', () => {
  it('labels count from the end: Championship, Semifinals, Quarterfinals, then Round n', () => {
    expect([1, 2, 3].map((r) => roundLabel(r, 3))).toEqual(['Quarterfinals', 'Semifinals', 'Championship'])
    expect([1, 2, 3, 4].map((r) => roundLabel(r, 4))).toEqual(['Round 1', 'Quarterfinals', 'Semifinals', 'Championship'])
    expect(roundLabel(1, 1)).toBe('Championship')
  })

  it('the badge is the LEAST-advanced week’s (§16.5.4); an unbuilt round wears none', () => {
    expect(roundBadge(BUILT_DOC.round_list[0])?.state).toBe('final')
    expect(roundBadge(BUILT_DOC.round_list[1])?.state).toBe('live')
    expect(roundBadge(BUILT_DOC.round_list[2])).toBeNull()
    expect(
      roundBadge({ built: true, weeks: [{ week: 17, status: 'final', rollover_at: null, corrections_close_at: null }, { week: 18, status: 'correction_window', rollover_at: null, corrections_close_at: null }] })?.state,
    ).toBe('pending_corrections')
  })

  it('TBD slots are `expected_games` (F256(c)) — never an invented pairing', () => {
    expect(PROJECTED_DOC.round_list.map(tbdSlots)).toEqual([4, 2, 1])
    expect(tbdSlots({ expected_games: 0 })).toBe(0)
  })

  it('`source` is labelled as "the prior stage is final NOW" (F256(a))', () => {
    expect(sourceLabel(BUILT_DOC.round_list[0])).toBe('Seeded from final results')
    expect(sourceLabel({ built: true, source: 'provisional' })).toContain('provisionally')
    expect(sourceLabel(BUILT_DOC.round_list[2])).toBeNull()
  })
})

describe('games — the verdict is 118’s `decided_by`, never re-decided', () => {
  it('points / higher_seed (Q39 (A)) / bye, with the tense following `final`', () => {
    const [bye, , points, tie] = BUILT_DOC.round_list[0].games
    expect(verdictCopy(bye).label).toBe('Bye')
    expect(verdictCopy(points).label).toBe('Advances on points')
    expect(verdictCopy(tie).label).toBe('Tied — higher seed advances')
    expect(verdictCopy({ ...points, final: false }).label).toBe('Leads on points')
    expect(verdictCopy({ ...tie, final: false }).label).toBe('Tied — higher seed would advance')
  })

  it('a two-week round says so in the hover (Q39 (B): the sum over both weeks)', () => {
    const final = COMPLETE_DOC.round_list[2].games[0]
    expect(final.weeks).toHaveLength(2)
    expect(verdictCopy(final).title).toContain('two-week totals are equal')
    expect(verdictCopy({ ...final, decided_by: 'points' }).title).toContain('added together')
  })

  it('D845 / F907: a NULL score is the scoreboard’s cell — the projected total once the week started, else the dash; never 0.00, never "pending"; totals are 118’s, formatted only', () => {
    const one = (home: number | null, status = 'live') => ({
      home_team_id: 'h',
      away_team_id: 'a',
      home_total: 0,
      away_total: 0,
      weeks: [{ week: 15, home_score: home, away_score: 40, status } as BracketGameWeek],
    })
    const live = () => 'live'
    const proj = (week: number, team: string) => (week === 15 && team === 'h' ? 98.44 : week === 16 && team === 'h' ? 10 : null)
    expect(bracketWeekCells(one(null), 'home', live, proj)).toEqual([{ text: 'Proj 98.4', title: PROJECTED_SCORE_TITLE, pending: false, projected: true }])
    expect(bracketWeekCells(one(null), 'home', () => 'final', proj)[0]).toMatchObject({ text: 'Proj 98.4', projected: true })
    expect(bracketWeekCells(one(null), 'home', live)[0]).toEqual({ text: '—', title: NO_PROJECTION_TITLE, pending: false })
    expect(bracketTotalCell(one(null), 'home', live, proj).text).toBe('Proj 98.4')
    expect(bracketTotalCell(one(101.25), 'home', live, proj)).toEqual({ text: '101.25', title: null, pending: false })
    expect(bracketTotalCell(one(0), 'home', live, proj).text).toBe('0.00')
    // 216 (F273): a two-week round nobody has been scored in isn't "0.00" (118's sum reads a blank as 0).
    const two = (home: number | null, away: number | null, status = 'live') => ({
      home_team_id: 'h',
      away_team_id: 'a',
      home_total: home ?? 0,
      away_total: away ?? 0,
      weeks: [
        { week: 15, home_score: home, away_score: away, status } as BracketGameWeek,
        { week: 16, home_score: null, away_score: null, status: 'scheduled' } as BracketGameWeek,
      ],
    })
    const statusOf = (week: number) => (week === 15 ? 'live' : 'upcoming')
    // A two-week round's total is the ROUND's number — its hover says so (PR #588 nit).
    expect(bracketTotalCell(two(null, null), 'home', statusOf, proj)).toEqual({ text: 'Proj 98.4', title: PROJECTED_ROUND_TITLE, pending: false, projected: true })
    expect(PROJECTED_ROUND_TITLE).toBe('Projected — this team hasn’t scored yet this round.')
    expect(bracketTotalCell(two(null, null), 'away', statusOf, proj)).toEqual({ text: '—', title: NO_PROJECTION_TITLE, pending: false })
    expect(bracketTotalCell(two(null, null, 'scheduled'), 'home', () => 'upcoming', proj)).toEqual({ text: '—', title: WEEK_NOT_STARTED_TITLE, pending: false })
    expect(bracketTotalCell(two(0, null), 'home', statusOf, proj).text).toBe('0.00')
    expect(bracketTotalCell(two(101.25, 90), 'away', statusOf, proj).text).toBe('90.00')
    // Both weeks started, neither scored: the two weeks' projections, added.
    expect(bracketTotalCell(two(null, null), 'home', () => 'live', proj).text).toBe('Proj 108.4')
    expect(bracketWeekCells(two(null, null), 'home', statusOf, proj).map((c) => c.text)).toEqual(['Proj 98.4', '—'])
    expect(formatTotal(150)).toBe('150.00')
  })

  it('bracketProjectionWeeks: the built rounds’ started weeks with an unscored side, by week and team (exact — R1808)', () => {
    expect(bracketProjectionWeeks({ ...BUILT_DOC, round_list: [] })).toEqual([])
    // Round 2 (week 16, live): Delta's side is NULL; Bravo v Charlie is scored. Round 1 is
    // fully scored (its byes have no away side); round 3 is unbuilt.
    expect(bracketProjectionWeeks(BUILT_DOC)).toEqual([{ week: 16, status: 'live', teamIds: [T.delta] }])
    // A final week with an unscored side is read too (D845), each week on its own.
    const r1 = BUILT_DOC.round_list[0]
    const echoBlank = {
      ...BUILT_DOC,
      round_list: [
        { ...r1, games: r1.games.map((g) => (g.away_team_id === T.echo ? { ...g, weeks: g.weeks.map((w) => ({ ...w, away_score: null })) } : g)) },
        ...BUILT_DOC.round_list.slice(1),
      ],
    }
    expect(bracketProjectionWeeks(echoBlank)).toEqual([
      { week: 15, status: 'final', teamIds: [T.echo] },
      { week: 16, status: 'live', teamIds: [T.delta] },
    ])
    // Nothing for an upcoming week, even with blank sides.
    expect(bracketProjectionWeeks(BUILT_UNPLAYED_DOC)).toEqual([])
    expect(roundWeekStatus(BUILT_DOC.round_list[0])(BUILT_DOC.round_list[0].weeks[0].week)).toBe(BUILT_DOC.round_list[0].weeks[0].status)
    expect(roundWeekStatus(null)(15)).toBeUndefined()
  })

  it('an UNPLAYED game (every row still `scheduled`) shows a dash, not 109’s DEFAULT 0 as a 0–0 tie (F273 / F257(a)) — read from the status, never inferred from a 0', () => {
    const g = (score: number | null, status: string) => ({ home_team_id: 'h', away_team_id: 'a', weeks: [{ week: 15, home_score: score, away_score: null, status } as BracketGameWeek] })
    expect(bracketWeekCells(g(0, 'scheduled'), 'home', () => 'upcoming')[0].text).toBe('—')
    expect(bracketWeekCells(g(null, 'scheduled'), 'home', () => 'upcoming', () => 50)[0].text).toBe('—')
    expect(bracketWeekCells(g(0, 'live'), 'home', () => 'live')[0].text).toBe('0.00')
    const unplayed = { weeks: [{ ...BUILT_DOC.round_list[0].games[2].weeks[0], status: 'scheduled' }] }
    expect(gamePlayed(unplayed)).toBe(false)
    expect(gamePlayed(BUILT_DOC.round_list[0].games[2])).toBe(true)
    expect(gamePlayed(BUILT_DOC.round_list[1].games[0])).toBe(true) // live counts as played (a score may be pending)
    expect(gamePlayed({ weeks: [] })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R846 / F257(b′) — seeded before a late correction
// ---------------------------------------------------------------------------

describe('seededBeforeCorrection — the view derives the marker the engine does not emit', () => {
  const finalRanks = [
    { rank: 1, team_id: T.alpha },
    { rank: 2, team_id: T.bravo },
    { rank: 3, team_id: T.charlie },
    { rank: 4, team_id: T.delta },
    { rank: 5, team_id: T.echo },
    { rank: 6, team_id: T.foxtrot },
  ]
  it('a built round whose frozen seeds MATCH the final standings is not labelled', () => {
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[0], finalRanks)).toBe(false)
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[1], finalRanks)).toBe(false)
  })
  it('a moved rank under a frozen seed IS labelled — on any built round (seeds are ORIGINAL seeds)', () => {
    const swapped = finalRanks.map((r) => (r.rank === 5 ? { ...r, team_id: T.foxtrot } : r.rank === 6 ? { ...r, team_id: T.echo } : r))
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[0], swapped)).toBe(true)
    // Round 2 carries seeds 1/4 and 2/3 only — the 5/6 swap does not touch it.
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[1], swapped)).toBe(false)
  })
  it('needs EVIDENCE: no label without final standings, while the regular season is not final, or on an unbuilt round', () => {
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[0], null)).toBe(false)
    expect(seededBeforeCorrection({ regular_season_final: false }, BUILT_DOC.round_list[0], [])).toBe(false)
    expect(seededBeforeCorrection(BUILT_DOC, BUILT_DOC.round_list[2], finalRanks)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The commissioner's result links and names
// ---------------------------------------------------------------------------

describe('commissioner result links (§10.1 / §16.2; L.E1.23, F377(c)) and names', () => {
  it('a commissioner gets ONE link per game to its matchup page — the real route, the stored row id; a manager or a viewer without a role gets none', () => {
    const [, , points] = BUILT_DOC.round_list[0].games
    expect(commishResultLinks('commissioner', 'league-1', points)).toEqual([
      { matchupId: 'm-r1-c', week: 15, href: '/app/leagues/league-1/matchup/m-r1-c', label: EDIT_RESULT_LABEL },
    ])
    expect(EDIT_RESULT_LABEL).toBe('Edit a result')
    expect(commishResultLinks('manager', 'league-1', points)).toEqual([])
    expect(commishResultLinks(null, 'league-1', points)).toEqual([])
  })
  it('a bye has no result, so no link; a two-week game gets one link per week row, each naming its week', () => {
    const [bye] = BUILT_DOC.round_list[0].games
    expect(bye.away_team_id).toBeNull() // premise: the fixture's first game IS a bye
    expect(commishResultLinks('commissioner', 'league-1', bye)).toEqual([])
    const final = COMPLETE_DOC.round_list[2].games[0]
    expect(final.weeks).toHaveLength(2) // premise: a two-week championship
    expect(commishResultLinks('commissioner', 'league-1', final).map((l) => [l.href, l.label])).toEqual([
      ['/app/leagues/league-1/matchup/m-r3-w17', 'Edit week 17'],
      ['/app/leagues/league-1/matchup/m-r3-w18', 'Edit week 18'],
    ])
  })
  it('names resolve through the detail’s teams map (F256(g)); an unknown id is said, a NULL is TBD', () => {
    expect(teamName(BRACKET_NAMES, T.alpha)).toBe('Alpha')
    expect(teamName(BRACKET_NAMES, 'nobody')).toBe('Unknown team')
    expect(teamName(BRACKET_NAMES, null)).toBe('TBD')
  })
})
