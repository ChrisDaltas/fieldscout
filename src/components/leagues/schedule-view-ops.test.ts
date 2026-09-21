/**
 * schedule-view-ops.test.ts — L.D5.3's schedule + Remix pure pins (spec
 * §11.7, §16.2 `schedule-view` / `schedule-remix-modal`, §16.5.2, §16.5.3;
 * PROGRESS D289/D290/D307/D317).
 *
 * What is pinned: the week grid (byes, second games, playoff weeks pending
 * BY NAME, total-points weeks by name), the commissioner's edit affordance
 * (the client-visible half of 111's gate), D290's TWO copies from the
 * server's window flag, the frozen-week reasons in words, the diff reducer
 * (grouped per week, the server's sentences kept), the side-by-side
 * (same / flipped / changed), the system-post preview and the confirm gate.
 */
import { describe, expect, it } from 'vitest'

import type { RemixDiffLine, RemixProposedRow } from '@/hooks/use-schedule'

import { NAMES, SCHEDULE, matchup } from './standings-schedule.fixtures'
import {
  EDIT_NO_CHANGE_COPY,
  EDIT_SELF_COPY,
  FREE_WINDOW_TITLE,
  NOTHING_REGENERABLE_COPY,
  NO_CHANGES_COPY,
  OVERRIDE_WINDOW_TITLE,
  PLAYOFF_PENDING_COPY,
  REASON_HINT_COPY,
  TOTAL_POINTS_WEEK_COPY,
  confirmGate,
  diffByWeek,
  editFormProblem,
  editableTeams,
  formatScore,
  frozenWeekCopy,
  matchupEditable,
  reasonHint,
  remixWindowCopy,
  scheduleGrid,
  sideBySide,
  systemPostPreview,
  weekKind,
  weekStatusBadge,
} from './schedule-view-ops'

const SETTINGS = { regular_season_weeks: 3, schedule_mode: 'h2h' }

describe('the week grid', () => {
  it('one cell per ladder week in week order; rows named; the playoff week pending BY NAME', () => {
    const grid = scheduleGrid(SCHEDULE, NAMES, SETTINGS, false)
    expect(grid.map((w) => [w.week, w.status, w.kind, w.rows.length])).toEqual([
      [1, 'final', 'regular', 2],
      [2, 'live', 'regular', 2],
      [3, 'upcoming', 'regular', 4],
      [4, 'upcoming', 'playoff', 0],
    ])
    expect(grid[3].note).toBe(PLAYOFF_PENDING_COPY)
    expect(grid[0].rows[0].home).toEqual({ id: 't1', name: 'Alpha' })
    expect(grid[0].rows[0].away).toEqual({ id: 't2', name: 'Bravo' })
    expect(grid[0].median_score).toBe(101.5)
    expect(grid[2].rows.filter((r) => r.round_type === 'secondary')).toHaveLength(2)
  })

  it('a bye row carries a null away side; an unknown team id renders by name as unknown', () => {
    const grid = scheduleGrid(
      {
        weeks: SCHEDULE.weeks.slice(0, 1),
        matchups: [matchup({ id: 'b', week: 1, home_team_id: 't9', away_team_id: null })],
      },
      NAMES,
      SETTINGS,
      false,
    )
    expect(grid[0].rows[0].away).toBeNull()
    expect(grid[0].rows[0].home.name).toBe('Unknown team')
  })

  it('a total-points league says why a regular week has no pairings; an empty ladder is an empty grid', () => {
    const grid = scheduleGrid(
      { weeks: SCHEDULE.weeks.slice(0, 1), matchups: [] },
      NAMES,
      { ...SETTINGS, schedule_mode: 'total_points' },
      false,
    )
    expect(grid[0].note).toBe(TOTAL_POINTS_WEEK_COPY)
    expect(scheduleGrid({ weeks: [], matchups: [] }, NAMES, SETTINGS, true)).toEqual([])
  })

  it('weekKind is positional in league-week terms (Q29): a mid-season league starting at week 10 with 4 regular weeks', () => {
    expect(weekKind(10, 10, 4)).toBe('regular')
    expect(weekKind(13, 10, 4)).toBe('regular')
    expect(weekKind(14, 10, 4)).toBe('playoff')
  })

  it('§16.5.4 badges per status; scores dash when scheduled and say pending when live-but-unscored (E61)', () => {
    expect(weekStatusBadge('upcoming')).toEqual({ label: 'Upcoming', variant: 'stroke' })
    expect(weekStatusBadge('live')).toEqual({ label: 'Live', variant: 'green' })
    expect(weekStatusBadge('correction_window')).toEqual({
      label: 'Final (pending corrections)',
      variant: 'yellow',
    })
    expect(weekStatusBadge('final')).toEqual({ label: 'Final', variant: 'black' })
    expect(formatScore(null, 'scheduled')).toBe('—')
    expect(formatScore(null, 'live')).toBe('pending')
    expect(formatScore(40.25, 'live')).toBe('40.25')
  })
})

describe('the commissioner’s edit affordance — the client-visible half of 111’s gate', () => {
  const row = SCHEDULE.matchups[4] // m5: week 3, scheduled, unscored

  it('shown to a commissioner on an upcoming week’s scheduled, unscored, un-overridden pairing; never to a manager', () => {
    expect(matchupEditable(row, 'upcoming', true)).toBe(true)
    expect(matchupEditable(row, 'upcoming', false)).toBe(false)
    const grid = scheduleGrid(SCHEDULE, NAMES, SETTINGS, true)
    expect(grid[2].rows.every((r) => r.editable)).toBe(true)
    expect(scheduleGrid(SCHEDULE, NAMES, SETTINGS, false)[2].rows.some((r) => r.editable)).toBe(
      false,
    )
  })

  it('hidden on a live/final week, a non-scheduled row, a scored row, an overridden row, a bye row, a playoff row', () => {
    expect(matchupEditable(row, 'live', true)).toBe(false)
    expect(matchupEditable(row, 'final', true)).toBe(false)
    expect(matchupEditable({ ...row, status: 'live' }, 'upcoming', true)).toBe(false)
    expect(matchupEditable({ ...row, home_score: 1 }, 'upcoming', true)).toBe(false)
    expect(matchupEditable({ ...row, is_overridden: true }, 'upcoming', true)).toBe(false)
    expect(matchupEditable({ ...row, result: 'home' }, 'upcoming', true)).toBe(false)
    expect(matchupEditable({ ...row, away_team_id: null }, 'upcoming', true)).toBe(false)
    expect(matchupEditable({ ...row, round_type: 'playoff' }, 'upcoming', true)).toBe(false)
    const grid = scheduleGrid(SCHEDULE, NAMES, SETTINGS, true)
    expect(grid[0].rows.some((r) => r.editable)).toBe(false)
    expect(grid[1].rows.some((r) => r.editable)).toBe(false)
  })

  it('the form refuses a self-pairing and a no-change before the round trip; retired teams are not offered', () => {
    const cell = { home: { id: 't1', name: 'Alpha' }, away: { id: 't4', name: 'Delta' } }
    expect(editFormProblem(cell, 't1', 't1')).toBe(EDIT_SELF_COPY)
    expect(editFormProblem(cell, 't1', 't4')).toBe(EDIT_NO_CHANGE_COPY)
    expect(editFormProblem(cell, 't4', 't1')).toBeNull() // a side flip is a change
    expect(editFormProblem(cell, 't1', 't2')).toBeNull()
    expect(
      editableTeams([
        { id: 't1', name: 'Alpha', status: 'active' },
        { id: 'tr', name: 'Retired FC', status: 'retired' },
      ]),
    ).toEqual([{ id: 't1', name: 'Alpha' }])
  })

  it('the reason HINT reads the ladder: the first week out of `upcoming` — and it is a hint, the server decides', () => {
    expect(reasonHint(SCHEDULE.weeks)).toBe(REASON_HINT_COPY)
    expect(
      reasonHint([
        { week: 1, status: 'upcoming' },
        { week: 2, status: 'upcoming' },
      ]),
    ).toBeNull()
    // A mid-season league's FIRST week is its own (Q29), whatever week 1 did.
    expect(
      reasonHint([
        { week: 10, status: 'upcoming' },
        { week: 11, status: 'upcoming' },
      ]),
    ).toBeNull()
    expect(reasonHint([])).toBeNull()
  })
})

describe('D290 — E41’s two states, both rendered from the SERVER’s flag', () => {
  it('free: no reason; the first game named when the datum is known', () => {
    const copy = remixWindowCopy({ free: true }, 'Sun 1:00 PM')
    expect(copy.tone).toBe('accent')
    expect(copy.title).toBe(FREE_WINDOW_TITLE)
    expect(copy.body).toContain('needs no reason')
    expect(copy.body).toContain('Sun 1:00 PM')
    expect(remixWindowCopy({ free: true }, null).body).not.toContain(
      'first game',
    )
  })

  it('override: audited and posted — a reason is OPTIONAL, never "required" (Q66 / F363(c))', () => {
    const copy = remixWindowCopy({ free: false }, 'Sun 1:00 PM')
    expect(copy.tone).toBe('caution')
    expect(copy.title).toBe(OVERRIDE_WINDOW_TITLE)
    expect(copy.body).toContain('A reason is optional')
    expect(copy.body).not.toMatch(/required/i)
    expect(copy.body).toContain('posted to league chat')
  })

  it('the window copy is keyed on `free` ALONE — a stale `reason_required: true` beside `free: true` (an un-pushed 132) changes nothing', () => {
    const stale = { free: true, reason_required: true }
    expect(remixWindowCopy(stale, null).title).toBe(FREE_WINDOW_TITLE)
  })

  it('the frozen-week reasons in words — every name 111 emits', () => {
    expect(frozenWeekCopy({ week: 2, week_status: 'live', reason: 'week_live' })).toBe(
      'Week 2 is live — kept as is.',
    )
    expect(frozenWeekCopy({ week: 1, week_status: 'final', reason: 'week_final' })).toBe(
      'Week 1 is final — kept as is.',
    )
    expect(frozenWeekCopy({ week: 3, week_status: 'upcoming', reason: 'week_kicked_off' })).toBe(
      'Week 3 has already kicked off — kept as is.',
    )
    expect(
      frozenWeekCopy({ week: 4, week_status: 'upcoming', reason: 'matchup_overridden_or_scored' }),
    ).toBe('Week 4 has a scored or commissioner-set matchup — kept as is.')
    expect(frozenWeekCopy({ week: 5, week_status: 'upcoming', reason: 'something_new' })).toBe(
      'Week 5 something_new — kept as is.',
    )
  })
})

const DIFF: RemixDiffLine[] = [
  {
    week: 3,
    round_type: 'regular',
    team_id: 't1',
    team_name: 'Alpha',
    old_opponent_id: 't4',
    old_opponent_name: 'Delta',
    new_opponent_id: 't3',
    new_opponent_name: 'Charlie',
    old_side: 'home',
    new_side: 'home',
    text: 'Week 3: Alpha now plays Charlie instead of Delta',
  },
  {
    week: 3,
    round_type: 'secondary',
    team_id: 't1',
    team_name: 'Alpha',
    old_opponent_id: 't2',
    old_opponent_name: 'Bravo',
    new_opponent_id: 't2',
    new_opponent_name: 'Bravo',
    old_side: 'home',
    new_side: 'away',
    text: 'Week 3 (second game): Alpha now visits Bravo (was home)',
  },
  {
    week: 2,
    round_type: 'regular',
    team_id: 't2',
    team_name: 'Bravo',
    old_opponent_id: 't4',
    old_opponent_name: 'Delta',
    new_opponent_id: 't1',
    new_opponent_name: 'Alpha',
    old_side: 'home',
    new_side: 'away',
    text: 'Week 2: Bravo now plays Alpha instead of Delta',
  },
]

describe('the diff reducer', () => {
  it('groups per (week, game type) in week order and keeps the server’s sentences verbatim', () => {
    const groups = diffByWeek(DIFF)
    expect(groups.map((g) => [g.week, g.round_type, g.lines.length])).toEqual([
      [2, 'regular', 1],
      [3, 'regular', 1],
      [3, 'secondary', 1],
    ])
    expect(groups[2].lines[0].text).toBe('Week 3 (second game): Alpha now visits Bravo (was home)')
    expect(diffByWeek([])).toEqual([])
  })
})

describe('the side-by-side', () => {
  const proposed: RemixProposedRow[] = [
    // week 3 regenerated: t1-t3 (new), t2-t4 (new); secondary t2-t1 flipped, t3-t4 same
    { week: 3, round_type: 'regular', home_team_id: 't1', away_team_id: 't3', regenerated: true },
    { week: 3, round_type: 'regular', home_team_id: 't2', away_team_id: 't4', regenerated: true },
    { week: 3, round_type: 'secondary', home_team_id: 't2', away_team_id: 't1', regenerated: true },
    { week: 3, round_type: 'secondary', home_team_id: 't3', away_team_id: 't4', regenerated: true },
    // week 2 frozen: identical rows, not regenerated
    { week: 2, round_type: 'regular', home_team_id: 't1', away_team_id: 't3', regenerated: false },
    { week: 2, round_type: 'regular', home_team_id: 't2', away_team_id: 't4', regenerated: false },
  ]

  it('marks each pairing same / flipped / changed on BOTH sides, weeks in order, frozen weeks kept', () => {
    const weeks = sideBySide(SCHEDULE.matchups, proposed, NAMES)
    expect(weeks.map((w) => [w.week, w.regenerated])).toEqual([
      [2, false],
      [3, true],
    ])
    const w2 = weeks[0]
    expect(w2.current.map((c) => c.state)).toEqual(['same', 'same'])
    expect(w2.proposed.map((c) => c.state)).toEqual(['same', 'same'])

    const w3 = weeks[1]
    expect(w3.current.map((c) => [c.round_type, c.text, c.state])).toEqual([
      ['regular', 'Alpha vs Delta', 'changed'],
      ['regular', 'Bravo vs Charlie', 'changed'],
      ['secondary', 'Alpha vs Bravo', 'flipped'],
      ['secondary', 'Charlie vs Delta', 'same'],
    ])
    expect(w3.proposed.map((c) => [c.round_type, c.text, c.state])).toEqual([
      ['regular', 'Alpha vs Charlie', 'changed'],
      ['regular', 'Bravo vs Delta', 'changed'],
      ['secondary', 'Bravo vs Alpha', 'flipped'],
      ['secondary', 'Charlie vs Delta', 'same'],
    ])
  })

  it('a week the plan does not mention is not shown (the plan is the whole regular season; playoff weeks are not its business)', () => {
    const weeks = sideBySide(
      SCHEDULE.matchups,
      proposed.filter((p) => p.week === 3),
      NAMES,
    )
    expect(weeks.map((w) => w.week)).toEqual([3])
  })
})

describe('the system-post preview and the confirm gate', () => {
  const plan = {
    weeks_regenerable: [3, 4, 5],
    regular_season_weeks: 14,
    change_count: 42,
    window: { free: true },
    no_changes: false,
  }

  it('mirrors 131’s sentence — free ends with a full stop; override carries the reason ONLY when one was given (the conditional clause, 131:3608-3610)', () => {
    expect(systemPostPreview(plan, '', 'chris')).toBe(
      'Schedule remixed by chris: 3 of 14 regular-season weeks regenerated (weeks 3, 4, 5), 42 team-week pairings changed.',
    )
    expect(
      systemPostPreview(
        { ...plan, window: { free: false } },
        ' bye-week balance ',
        'chris',
      ),
    ).toBe(
      'Schedule remixed by chris: 3 of 14 regular-season weeks regenerated (weeks 3, 4, 5), 42 team-week pairings changed — after Week 1 kickoff (commissioner override) — reason: bye-week balance',
    )
    // No reason ⇒ NO "— reason:" tail — never an empty clause, never a "…".
    expect(systemPostPreview({ ...plan, window: { free: false } }, '   ', 'chris')).toBe(
      'Schedule remixed by chris: 3 of 14 regular-season weeks regenerated (weeks 3, 4, 5), 42 team-week pairings changed — after Week 1 kickoff (commissioner override)',
    )
  })

  it('confirm is gated on the server’s plan — no plan, nothing regenerable, no changes — and NEVER on a reason (Q66 / F363(c) / R1056)', () => {
    expect(confirmGate(null)).toEqual({ ok: false, why: 'Preview a remix first.' })
    expect(confirmGate({ ...plan, weeks_regenerable: [] })).toEqual({
      ok: false,
      why: NOTHING_REGENERABLE_COPY,
    })
    expect(confirmGate({ ...plan, no_changes: true })).toEqual({
      ok: false,
      why: NO_CHANGES_COPY,
    })
    // After kickoff, with a database that STILL answers `reason_required:
    // true` (132 not pushed yet): Confirm is open. The verb (131) lands it.
    const stale = { ...plan, window: { free: false, reason_required: true } }
    expect(confirmGate(stale)).toEqual({ ok: true })
    expect(confirmGate(plan)).toEqual({ ok: true })
  })
})
