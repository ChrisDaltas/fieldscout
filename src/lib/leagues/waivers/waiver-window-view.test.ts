/**
 * waiver-window-view.test.ts — the league detail's `waiver_window` (M5 task
 * L.D2.13, PROGRESS F425 / D414): the TS composition of 153's
 * `waiver_window_internal` facts. Every instant is a STORED LITERAL; the
 * boundary instants (the run, the ceiling, one millisecond either side) are
 * pinned directly.
 */
import { describe, expect, it } from 'vitest'

import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { waiverWindowView, weekLockRelease, windowResetAt, type WaiverWindowInputs } from './waiver-window-view'

// 2026 week 1: `nfl_weeks.starts_at` is Wednesday 00:00 Eastern.
const WEEK1 = { starts_at: '2026-09-09T04:00:00.000Z', last_game_ends_at: null as string | null }
// Its ceiling: Wednesday 2026-09-16 00:00 PDT.
const WEEK1_CEILING = '2026-09-16T07:00:00.000Z'
const DRAFT_DONE = '2026-09-05T20:00:00.000Z'

const settings = defaultsForTeamCount(8) // Wednesday 03:00 America/New_York, free agency after the run
function inputs(over: Partial<WaiverWindowInputs>): WaiverWindowInputs {
  return { settings, draftCompletedAt: [DRAFT_DONE], weeks: [WEEK1], pendingRunAt: null, paused: false, at: new Date('2026-09-08T12:00:00.000Z'), ...over }
}

describe('weekLockRelease — 153’s LEAST(recorded end, the Wednesday 00:00 Pacific ceiling)', () => {
  it('no recorded end ⇒ the ceiling', () => {
    expect(new Date(weekLockRelease(WEEK1)).toISOString()).toBe(WEEK1_CEILING)
  })
  it('a recorded end before the ceiling wins; one after it is capped', () => {
    expect(new Date(weekLockRelease({ ...WEEK1, last_game_ends_at: '2026-09-15T03:30:00.000Z' })).toISOString()).toBe('2026-09-15T03:30:00.000Z')
    expect(new Date(weekLockRelease({ ...WEEK1, last_game_ends_at: '2026-09-17T01:00:00.000Z' })).toISOString()).toBe(WEEK1_CEILING)
  })
})

describe('windowResetAt — the latest of draft completion and any week end, never after `at`', () => {
  it('before any week ends: the draft', () => {
    expect(windowResetAt(inputs({}))?.toISOString()).toBe(DRAFT_DONE)
  })
  it('at the ceiling instant the week end counts; a millisecond before it does not', () => {
    expect(windowResetAt(inputs({ at: new Date(WEEK1_CEILING) }))?.toISOString()).toBe(WEEK1_CEILING)
    expect(windowResetAt(inputs({ at: new Date(Date.parse(WEEK1_CEILING) - 1) }))?.toISOString()).toBe(DRAFT_DONE)
  })
  it('nothing happened yet ⇒ null', () => {
    expect(windowResetAt(inputs({ draftCompletedAt: [null], weeks: [] }))).toBeNull()
  })
})

describe('waiverWindowView — the four facts composed (display only)', () => {
  it('after the draft, before the first run: claims only, the next run named (Wed 03:00 EDT)', () => {
    const w = waiverWindowView(inputs({}))
    expect(w).toEqual({
      waivers: true,
      free_agency_open: false,
      why: 'awaiting_run',
      next_run_at: '2026-09-09T07:00:00.000Z',
      last_run_at: '2026-09-02T07:00:00.000Z',
      last_open_at: null,
      time_zone: 'America/New_York',
      paused: false,
      evaluated_at: '2026-09-08T12:00:00.000Z',
    })
  })
  it('untracked league: free agency opens AT the run instant, not a millisecond before', () => {
    expect(waiverWindowView(inputs({ at: new Date('2026-09-09T07:00:00.000Z') })).free_agency_open).toBe(true)
    expect(waiverWindowView(inputs({ at: new Date(Date.parse('2026-09-09T07:00:00.000Z') - 1) })).free_agency_open).toBe(false)
  })
  it('tracked league whose due run is not settled yet: run_pending, still shut (E8)', () => {
    const w = waiverWindowView(inputs({ at: new Date('2026-09-09T07:00:30.000Z'), pendingRunAt: '2026-09-09T07:00:00.000Z' }))
    expect(w.free_agency_open).toBe(false)
    expect(w.why).toBe('run_pending')
    // …and once the processor advanced it to the next run, open.
    expect(waiverWindowView(inputs({ at: new Date('2026-09-09T07:01:00.000Z'), pendingRunAt: '2026-09-16T07:00:00.000Z' })).why).toBe('open')
  })
  it('the week’s ceiling shuts free agency until the next run — a run AT the ceiling counts once settled (Q78)', () => {
    // Wednesday 00:00 PDT is 03:00 EDT: the default run falls exactly on the ceiling.
    const justBefore = waiverWindowView(inputs({ at: new Date(Date.parse(WEEK1_CEILING) - 1) }))
    expect(justBefore.why).toBe('open')
    const pending = waiverWindowView(inputs({ at: new Date(WEEK1_CEILING), pendingRunAt: WEEK1_CEILING }))
    expect(pending).toMatchObject({ free_agency_open: false, why: 'run_pending' })
    // Untracked, the scheduled run AT the reset counts ("waivers run on schedule").
    expect(waiverWindowView(inputs({ at: new Date(WEEK1_CEILING) })).why).toBe('open')
    // A league whose run is later than the ceiling (Wednesday 09:00 Pacific) is claims-only in between.
    const later = waiverWindowView(
      inputs({ settings: { ...settings, waiver_run_time: '09:00', waiver_time_zone: 'America/Los_Angeles' }, at: new Date('2026-09-16T10:00:00.000Z') }),
    )
    expect(later).toMatchObject({ free_agency_open: false, why: 'awaiting_run', next_run_at: '2026-09-16T16:00:00.000Z' })
  })
  it('no waivers: always open, nothing scheduled', () => {
    const w = waiverWindowView(inputs({ settings: { ...settings, waiver_type: 'none_fcfs' } }))
    expect(w).toMatchObject({ waivers: false, free_agency_open: true, why: 'no_waivers', next_run_at: null })
  })
  it('the kill switch and an unparseable pending instant pass through as facts, never as a guess', () => {
    expect(waiverWindowView(inputs({ paused: true })).paused).toBe(true)
    expect(waiverWindowView(inputs({ pendingRunAt: 'garbage', at: new Date('2026-09-09T08:00:00.000Z') })).why).toBe('open')
  })
})
