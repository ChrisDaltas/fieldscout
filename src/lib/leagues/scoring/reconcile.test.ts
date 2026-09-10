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
  FINAL_NO_LINE_GRACE_MS,
  finalNoLineActionable,
  GAME_LATE_MS,
  inWeekGames,
  queueFindings,
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

  it('IN FLIGHT: a starter still queued explains a mismatch (info) whatever the row’s age; an agreeing cell is nothing — the queue’s AGE is not the cell’s finding (R881)', () => {
    const fresh = new Map([['p1', new Date(NOW.getTime() - STALE_QUEUE_MS).toISOString()]])
    expect(classifyCell(92.08, team(93.08), ctx({ starterQueuedAt: fresh }))).toMatchObject({ kind: 'in_flight', severity: 'info' })
    expect(classifyCell(92.08, team(92.08), ctx({ starterQueuedAt: fresh }))).toBeNull()
    const stale = new Map([['p1', new Date(NOW.getTime() - STALE_QUEUE_MS - 1).toISOString()]])
    expect(classifyCell(92.08, team(93.08), ctx({ starterQueuedAt: stale }))).toMatchObject({ kind: 'in_flight', severity: 'info' })
    expect(classifyCell(92.08, team(92.08), ctx({ starterQueuedAt: stale }))).toBeNull()
  })

  it('STUCK QUEUE (R881): one alert PER QUEUE ROW — exactly one hour old is in flight, one millisecond more is stuck; two cells starting the player share the one row’s alert', () => {
    const atHour = { week: 1, player_id: 'p1', enqueued_at: new Date(NOW.getTime() - STALE_QUEUE_MS).toISOString() }
    expect(queueFindings([atHour], 2026, NOW)).toEqual([])
    const past = { week: 1, player_id: 'p1', enqueued_at: new Date(NOW.getTime() - STALE_QUEUE_MS - 1).toISOString() }
    const out = queueFindings([past, atHour, { ...past, week: 2 }], 2026, NOW)
    expect(out.map((f) => [f.kind, f.severity, f.week, f.player_id])).toEqual([
      ['stuck_queue', 'alert', 1, 'p1'],
      ['stuck_queue', 'alert', 2, 'p1'],
    ])
    expect(out[0].league_id).toBeUndefined() // season-wide, beside the calendar findings — never per cell
    expect(out[0].message).toMatch(/is 60 min old \(> 60\) — the worker is not draining it/)
  })

  it('PENDING vs stored: alert on h2h, warn on total_points (F263(c))', () => {
    const pending = team(null, ['p1'], [{ player_id: 'p1', keys: ['example_charted_yards'] }])
    expect(classifyCell(19.5, pending, ctx())).toMatchObject({ kind: 'pending_vs_stored', severity: 'alert' })
    const tp = classifyCell(19.5, pending, ctx({ mode: 'total_points' }))
    expect(tp).toMatchObject({ kind: 'pending_vs_stored', severity: 'warn' })
    expect(tp!.explanation).toMatch(/F263\(c\)/)
  })

  it('POST-WINDOW CORRECTION: a FINAL week whose starter moved after the window is a WARN naming the delta (§23.4; R876 — never info, never exit-1); the same delta inside the window, or on a non-final week, is DRIFT', () => {
    const afterWindow = new Map([['p1', '2026-09-17T10:00:00.001Z']]) // one millisecond past the close
    const atWindow = new Map([['p1', '2026-09-17T10:00:00.000Z']]) // exactly at the close — inside
    const pw = classifyCell(92.08, team(93.08), ctx({ weekStatus: 'final', starterUpdatedAt: afterWindow }))
    expect(pw).toMatchObject({ kind: 'post_window_correction', severity: 'warn' })
    expect(pw!.explanation).toContain('stored 92.08 ≠ recomputed 93.08, Δ 1.00')
    expect(pw!.explanation).toMatch(/NOT EXACT \(R876\/F268\)/)
    expect(classifyCell(93.08, team(92.08), ctx({ weekStatus: 'final', starterUpdatedAt: afterWindow }))!.explanation).toContain('Δ -1.00')
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

  it('Q50 the FLOOR: an all-final week holding a FUTURE release stamp is NOT unstamped — the alert keeps meaning F238', () => {
    // The floor makes `weekBounds` stamp the Tuesday 00:00 PT instant at the
    // observing poll, so between the last whistle (~Mon 20:40 PT) and the
    // floor the column carries a FUTURE instant rather than NULL. If it held
    // NULL instead, this alert would fire for every league every week and a
    // real un-observed release (F238) would be indistinguishable from noise.
    // R982: `now` must sit BEFORE the floor or this cell is vacuous — the first
    // cut used 12:00Z, five hours PAST the 07:00Z stamp, which made it a
    // duplicate of the "a stamp present ⇒ nothing" cell above and left it green
    // through the very regression it pins (a `calendarFindings` refined to
    // "the release has not happened yet", i.e. `> nowMs`, which would restore
    // the F238 alert storm). 04:00Z is Mon 21:00 PDT — the real held window.
    const now = new Date('2026-09-15T04:00:00.000Z')
    const week1 = (rows: ReturnType<typeof calendarFindings>) => rows.filter((f) => f.week === 1).map((f) => f.kind)
    const games = [g('a', 1, '2026-09-10T00:20:00.000Z', 'final')]
    const floored = [{ ...WEEKS[0], last_game_ends_at: '2026-09-15T07:00:00.000Z' }, ...WEEKS.slice(1)] // 3 h AHEAD of `now`
    expect(week1(calendarFindings(floored, games, now))).toEqual([])
    // The one-unit sibling: the same week with NULL still alerts.
    expect(week1(calendarFindings(WEEKS, games, now))).toEqual(['all_final_unstamped'])
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
    expect(late[0].message).toMatch(/becomes an ALERT once the week is past its correction window \(2026-09-17T10:00:00.000Z\)/)
  })

  it('game_not_final_late (R878): a WARN at the correction window’s instant, an ALERT one millisecond past it — the week can no longer finalize; the message says what is stuck and the operator escape; a NULL window never alerts', () => {
    const games = [g('x', 1, '2026-09-13T17:00:00.000Z', 'live')]
    const windowEnd = new Date(WEEKS[0].correction_window_ends_at!)
    const atWindow = calendarFindings(WEEKS.slice(0, 1), games, windowEnd)
    expect(atWindow.map((f) => [f.kind, f.severity])).toEqual([['game_not_final_late', 'warn']])
    const past = calendarFindings(WEEKS.slice(0, 1), games, new Date(windowEnd.getTime() + 1))
    expect(past.map((f) => [f.kind, f.severity])).toEqual([['game_not_final_late', 'alert']])
    expect(past[0].message).toMatch(/PAST ITS CORRECTION WINDOW \(2026-09-17T10:00:00.000Z\) AND CAN NO LONGER FINALIZE/)
    expect(past[0].message).toMatch(/last_game_ends_at cannot be written/)
    expect(past[0].message).toMatch(/held at 'live'/)
    expect(past[0].message).toMatch(/Q37's nfl_games edit/)
    expect(past[0].message).toMatch(/three times a minute/)
    expect(past[0].detail).toMatchObject({ game_id: 'x', past_correction_window: true })
    const noWindow = calendarFindings([{ ...WEEKS[0], correction_window_ends_at: null }], games, new Date('2026-12-01T00:00:00.000Z'))
    expect(noWindow.map((f) => [f.kind, f.severity])).toEqual([['game_not_final_late', 'warn']])
  })
})

describe('finalNoLineActionable — F263(g) is emitted only while actionable (R877)', () => {
  it('the window ahead ⇒ actionable; closed exactly 24 h ago ⇒ still actionable (the Thursday run sees it once); one millisecond more ⇒ not; a NULL window reads as open', () => {
    const windowEnd = '2026-09-17T10:00:00.000Z'
    const graceEnd = new Date(windowEnd).getTime() + FINAL_NO_LINE_GRACE_MS
    expect(finalNoLineActionable(windowEnd, new Date('2026-09-15T12:00:00.000Z'))).toBe(true)
    expect(finalNoLineActionable(windowEnd, new Date(graceEnd - 1))).toBe(true)
    expect(finalNoLineActionable(windowEnd, new Date(graceEnd))).toBe(true)
    expect(finalNoLineActionable(windowEnd, new Date(graceEnd + 1))).toBe(false)
    expect(finalNoLineActionable(null, new Date('2027-01-01T00:00:00.000Z'))).toBe(true)
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
