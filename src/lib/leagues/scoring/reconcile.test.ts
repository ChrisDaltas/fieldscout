/**
 * reconcile.test.ts — the PURE half of §23.2's reconciliation (L.D2.3;
 * spec §23.2 / §23.4 / §24.1; PROGRESS F238 / F263(g) / D294 / D322). The
 * classifier and the calendar findings are pinned on hand-built rows and
 * literal instants; the stack half (`reconcile-db.test.ts`) plants the
 * drift for real and shows the alert naming it.
 */
import { describe, expect, it } from 'vitest'

import {
  CALENDAR_LOOKAHEAD_MS,
  calendarFindings,
  type CalendarGameRow,
  type CalendarWeekRow,
  type CellContext,
  classifyCell,
  GAME_LATE_MS,
  inWeekGames,
  renderFindings,
  sameScore,
  STALE_QUEUE_MS,
} from './reconcile'
import type { TeamWeekScore } from './score-week-worker'

function team(points: number | null, starters: string[] = ['p1', 'p2'], pending: Array<{ player_id: string; keys: string[] }> = []): TeamWeekScore {
  return {
    team_id: 'T1',
    points,
    starters: starters.map((pid) => ({ player_id: pid, position: 'WR', points: 10, pending: [], reason: 'scored' as const })),
    pending,
    no_stat_row: [],
  }
}

const NOW = new Date('2026-09-15T12:00:00.000Z')

function ctx(over: Partial<CellContext> = {}): CellContext {
  return {
    mode: 'h2h',
    weekStatus: 'live',
    windowEndsAt: '2026-09-17T10:00:00.000Z',
    starterUpdatedAt: new Map(),
    starterQueuedAt: new Map(),
    now: NOW,
    ...over,
  }
}

describe('sameScore — two-decimal equality, null only equals null', () => {
  it('pins', () => {
    expect(sameScore(92.08, 92.08)).toBe(true)
    expect(sameScore(92.08, 92.09)).toBe(false)
    expect(sameScore(0.1 + 0.2, 0.3)).toBe(true) // float noise collapsed at the stored precision
    expect(sameScore(null, null)).toBe(true)
    expect(sameScore(null, 0)).toBe(false)
    expect(sameScore(0, null)).toBe(false)
  })
})

describe('classifyCell — the order of explanations', () => {
  it('agreement ⇒ null', () => {
    expect(classifyCell(92.08, team(92.08), ctx())).toBeNull()
    expect(classifyCell(null, team(null, ['p1'], [{ player_id: 'p1', keys: ['example_charted_yards'] }]), ctx())).toBeNull()
  })

  it('DRIFT: stored ≠ recomputed with no benign explanation — an alert naming both numbers', () => {
    const v = classifyCell(92.08, team(93.08), ctx())
    expect(v).toMatchObject({ kind: 'drift', severity: 'alert' })
    expect(v!.explanation).toBe('stored 92.08 ≠ recomputed 93.08 from raw player_stats through the frozen snapshot (§23.2)')
  })

  it('IN FLIGHT: a starter still queued explains a mismatch (info) — but a queue row older than an hour is STUCK (alert), even when the cell agrees', () => {
    const fresh = new Map([['p1', new Date(NOW.getTime() - STALE_QUEUE_MS).toISOString()]]) // exactly one hour old — not yet stale
    expect(classifyCell(92.08, team(93.08), ctx({ starterQueuedAt: fresh }))).toMatchObject({ kind: 'in_flight', severity: 'info' })
    expect(classifyCell(92.08, team(92.08), ctx({ starterQueuedAt: fresh }))).toBeNull()
    const stale = new Map([['p1', new Date(NOW.getTime() - STALE_QUEUE_MS - 1).toISOString()]]) // one millisecond past the hour
    expect(classifyCell(92.08, team(93.08), ctx({ starterQueuedAt: stale }))).toMatchObject({ kind: 'stuck_queue', severity: 'alert' })
    expect(classifyCell(92.08, team(92.08), ctx({ starterQueuedAt: stale }))).toMatchObject({ kind: 'stuck_queue' })
  })

  it('PENDING vs stored: alert on h2h, warn on total_points (F263(c))', () => {
    const pending = team(null, ['p1'], [{ player_id: 'p1', keys: ['example_charted_yards'] }])
    expect(classifyCell(19.5, pending, ctx())).toMatchObject({ kind: 'pending_vs_stored', severity: 'alert' })
    const tp = classifyCell(19.5, pending, ctx({ mode: 'total_points' }))
    expect(tp).toMatchObject({ kind: 'pending_vs_stored', severity: 'warn' })
    expect(tp!.explanation).toMatch(/F263\(c\)/)
  })

  it('POST-WINDOW CORRECTION: a FINAL week whose starter moved after the window is info (§23.4); the same delta inside the window, or on a non-final week, is DRIFT', () => {
    const afterWindow = new Map([['p1', '2026-09-17T10:00:00.001Z']]) // one millisecond past the close
    const atWindow = new Map([['p1', '2026-09-17T10:00:00.000Z']]) // exactly at the close — inside
    expect(classifyCell(92.08, team(93.08), ctx({ weekStatus: 'final', starterUpdatedAt: afterWindow }))).toMatchObject({ kind: 'post_window_correction', severity: 'info' })
    expect(classifyCell(92.08, team(93.08), ctx({ weekStatus: 'final', starterUpdatedAt: atWindow }))).toMatchObject({ kind: 'drift' })
    expect(classifyCell(92.08, team(93.08), ctx({ weekStatus: 'correction_window', starterUpdatedAt: afterWindow }))).toMatchObject({ kind: 'drift' })
    expect(classifyCell(92.08, team(93.08), ctx({ weekStatus: 'final', windowEndsAt: null, starterUpdatedAt: afterWindow }))).toMatchObject({ kind: 'drift' })
  })
})

const WEEKS: CalendarWeekRow[] = [
  { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00.000Z', last_game_ends_at: null, correction_window_ends_at: '2026-09-17T10:00:00.000Z' },
  { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00.000Z', last_game_ends_at: null, correction_window_ends_at: '2026-09-24T10:00:00.000Z' },
  { season: 2026, week: 3, starts_at: '2026-09-23T04:00:00.000Z', last_game_ends_at: null, correction_window_ends_at: '2026-10-01T10:00:00.000Z' },
]

function g(id: string, week: number, kickoff_at: string, status: string | null): CalendarGameRow {
  return { id, season: 2026, week, kickoff_at, status, home_team: 'SEA', away_team: 'NE' }
}

describe('inWeekGames — 116’s rule for a postponed game leaving the week', () => {
  it('a postponed game at or past the next week’s start has left; one still inside the week has not; with no later week nothing leaves', () => {
    const games = [g('a', 1, '2026-09-16T04:00:00.000Z', 'postponed'), g('b', 1, '2026-09-16T03:59:59.999Z', 'postponed'), g('c', 1, '2026-09-13T17:00:00.000Z', 'final')]
    expect(inWeekGames(games, 1, WEEKS[1].starts_at).map((x) => x.id)).toEqual(['b', 'c'])
    expect(inWeekGames(games, 1, null).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('calendarFindings — F228 / F238 / Q37’s shape', () => {
  it('no_game_rows: a week starting within 7 days (inclusive at the boundary) with zero rows alerts; a week further out does not', () => {
    const now = new Date(WEEKS[1].starts_at)
    now.setTime(now.getTime() - CALENDAR_LOOKAHEAD_MS) // week 2 starts exactly 7 days from now
    const out = calendarFindings(WEEKS, [g('w1', 1, '2026-09-10T00:20:00.000Z', 'final')], now)
    expect(out.map((f) => [f.kind, f.week])).toEqual([
      ['all_final_unstamped', 1],
      ['no_game_rows', 2],
    ])
    const later = calendarFindings(WEEKS, [], new Date(now.getTime() - 1))
    expect(later.map((f) => [f.kind, f.week])).toEqual([['no_game_rows', 1]]) // week 2 one millisecond outside the lookahead
    expect(out[1].severity).toBe('alert')
    expect(out[1].message).toMatch(/F228/)
  })

  it('all_final_unstamped: every in-week game final and no stamp ⇒ alert; a stamp present ⇒ nothing; a postponed game that left the week does not hold it', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const week1 = (rows: ReturnType<typeof calendarFindings>) => rows.filter((f) => f.week === 1).map((f) => f.kind)
    // (week 2 has no rows within the lookahead — its own `no_game_rows` is filtered out here; the first cell pins it)
    const games = [g('a', 1, '2026-09-10T00:20:00.000Z', 'final'), g('b', 1, '2026-09-16T04:00:00.000Z', 'postponed')]
    expect(week1(calendarFindings(WEEKS, games, now))).toEqual(['all_final_unstamped'])
    // With NO later calendar row nothing can leave the week (116's loud reading): the postponed game holds it open.
    expect(week1(calendarFindings(WEEKS.slice(0, 1), games, now))).toEqual([])
    const stamped = [{ ...WEEKS[0], last_game_ends_at: '2026-09-15T04:00:00.000Z' }, ...WEEKS.slice(1)]
    expect(week1(calendarFindings(stamped, games, now))).toEqual([])
    const stillOpen = [g('a', 1, '2026-09-10T00:20:00.000Z', 'final'), g('c', 1, '2026-09-14T00:20:00.000Z', 'live')]
    expect(week1(calendarFindings(WEEKS, stillOpen, now))).toEqual(['game_not_final_late']) // not unstamped — a game is open; but it is late
  })

  it('game_not_final_late: exactly 8 h past kickoff is not late; one millisecond more is (warn); a final game never is', () => {
    const kick = '2026-09-13T17:00:00.000Z'
    const at8h = new Date(new Date(kick).getTime() + GAME_LATE_MS)
    const games = [g('x', 1, kick, 'live'), g('y', 1, '2026-09-10T00:20:00.000Z', 'final')]
    expect(calendarFindings(WEEKS.slice(0, 1), games, at8h)).toEqual([])
    const late = calendarFindings(WEEKS.slice(0, 1), games, new Date(at8h.getTime() + 1))
    expect(late).toHaveLength(1)
    expect(late[0]).toMatchObject({ kind: 'game_not_final_late', severity: 'warn', week: 1 })
    expect(late[0].message).toMatch(/game x \(NE @ SEA\) kicked off 8 h ago and is still 'live'/)
  })
})

describe('renderFindings — alerts first', () => {
  it('orders by severity then kind', () => {
    const lines = renderFindings({
      ran_at: '',
      season: 2026,
      leagues: 0,
      league_weeks: 0,
      cells: 0,
      excluded_overridden: 0,
      findings: [
        { kind: 'in_flight', severity: 'info', season: 2026, message: 'i' },
        { kind: 'no_lineup_row', severity: 'warn', season: 2026, message: 'w' },
        { kind: 'drift', severity: 'alert', season: 2026, message: 'a' },
      ],
      counts: {},
      alerts: 1,
      warns: 1,
      infos: 1,
      reason: null,
    })
    expect(lines).toEqual(['[ALERT] drift: a', '[WARN] no_lineup_row: w', '[INFO] in_flight: i'])
  })
})
