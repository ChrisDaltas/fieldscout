import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WAIVER_SCHEDULE,
  WAIVER_PRESETS,
  canonicalWeekdays,
  describeWaiverSchedule,
  freeAgencyWindow,
  lastFreeAgencyOpen,
  lastWaiverRun,
  matchWaiverPreset,
  nextWaiverRun,
  type WaiverSchedule,
  type WindowInput,
} from './waiver-schedule'
import { zonedWallToUtc } from './zoned-time'

/**
 * The waiver schedule (M5 L.D2.7; Q70 as ruled; spec §7.3.4 v2.16.59).
 *
 * Every expected instant below is a STORED LITERAL worked out by hand from
 * the zone rules (the 2026 fall-back is Sunday 2026-11-01 02:00 local; the
 * 2027 spring-forward is Sunday 2027-03-14 02:00 local) — never recomputed
 * through the code under test. pgTAP 097 pins the SAME literals against the
 * database's own `AT TIME ZONE`, so the TS twin and SQL cannot drift.
 */

const preset = (id: string): WaiverSchedule => {
  const p = WAIVER_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  return p.schedule
}
const DAILY = preset('daily_weekend_free_agency') // Chris's league 1
const WEEKLY = preset('weekly_then_free_agency') // Chris's league 2
const at = (iso: string) => new Date(iso)
const iso = (d: Date | null) => (d === null ? null : d.toISOString())

describe('zonedWallToUtc — PostgreSQL’s rule for the two DST edges (pgTAP 097 pins the same literals)', () => {
  it('an ordinary wall time either side of the 2026 fall-back', () => {
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2026, 10, 31, 9, 0))).toBe('2026-10-31T16:00:00.000Z') // PDT
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2026, 11, 3, 9, 0))).toBe('2026-11-03T17:00:00.000Z') // PST
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2026, 11, 1, 6, 0))).toBe('2026-11-01T14:00:00.000Z') // PST, the same morning
    expect(iso(zonedWallToUtc('America/New_York', 2026, 11, 4, 3, 0))).toBe('2026-11-04T08:00:00.000Z') // EST
  })
  it('a wall time that happens TWICE (01:30 on 2026-11-01) is the LATER instant — 01:30 PST', () => {
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2026, 11, 1, 1, 30))).toBe('2026-11-01T09:30:00.000Z')
    expect(iso(zonedWallToUtc('America/New_York', 2026, 11, 1, 1, 30))).toBe('2026-11-01T06:30:00.000Z')
  })
  it('a wall time that does NOT exist (02:30 on 2027-03-14) is read with the offset before the jump — 03:30 PDT', () => {
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2027, 3, 14, 2, 30))).toBe('2027-03-14T10:30:00.000Z')
    expect(iso(zonedWallToUtc('America/New_York', 2027, 3, 14, 2, 30))).toBe('2027-03-14T07:30:00.000Z')
  })
  it('a day that overflows its month normalizes (Oct 34 → Nov 3)', () => {
    expect(iso(zonedWallToUtc('America/Los_Angeles', 2026, 10, 34, 9, 0))).toBe('2026-11-03T17:00:00.000Z')
  })
})

describe('nextWaiverRun / lastWaiverRun — the table, across zones and the DST week', () => {
  const cases: ReadonlyArray<[name: string, s: WaiverSchedule, after: string, next: string]> = [
    // league 1: Tue–Sat 09:00 Pacific
    ['daily, Saturday morning before the run', DAILY, '2026-10-31T15:59:59.000Z', '2026-10-31T16:00:00.000Z'],
    ['daily, AT the Saturday run → strictly after: Tuesday, across the fall-back', DAILY, '2026-10-31T16:00:00.000Z', '2026-11-03T17:00:00.000Z'],
    ['daily, Sunday (no run) → Tuesday', DAILY, '2026-11-01T14:00:00.000Z', '2026-11-03T17:00:00.000Z'],
    ['daily, Tuesday after the run → Wednesday', DAILY, '2026-11-03T17:00:00.001Z', '2026-11-04T17:00:00.000Z'],
    // league 2: Wednesday 00:00 Pacific ("Tuesday at midnight")
    ['weekly, the week before the fall-back', WEEKLY, '2026-10-27T12:00:00.000Z', '2026-10-28T07:00:00.000Z'],
    ['weekly, the fall-back week: 169 hours after the last run', WEEKLY, '2026-10-28T07:00:00.000Z', '2026-11-04T08:00:00.000Z'],
    // the catalog default: Wednesday 03:00 Eastern
    ['default, the fall-back week (EDT → EST)', DEFAULT_WAIVER_SCHEDULE, '2026-10-28T07:00:00.000Z', '2026-11-04T08:00:00.000Z'],
    // a run at an AMBIGUOUS wall time: Sundays 01:30 Pacific — the later 01:30 on the fall-back day
    ['Sunday 01:30 Pacific, into the fall-back day', { ...DAILY, waiver_run_days: ['sun'], waiver_run_time: '01:30' }, '2026-10-25T08:30:00.000Z', '2026-11-01T09:30:00.000Z'],
    // a run at a NONEXISTENT wall time: Sundays 02:30 Pacific on the spring-forward day
    ['Sunday 02:30 Pacific, into the spring-forward day', { ...DAILY, waiver_run_days: ['sun'], waiver_run_time: '02:30' }, '2027-03-08T00:00:00.000Z', '2027-03-14T10:30:00.000Z'],
    // a zone far from the US: every day 00:00 Tokyo (no DST)
    ['Tokyo midnight, every day', { ...DAILY, waiver_run_days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], waiver_run_time: '00:00', waiver_time_zone: 'Asia/Tokyo' }, '2026-11-01T15:00:00.000Z', '2026-11-02T15:00:00.000Z'],
  ]
  for (const [name, s, after, next] of cases) {
    it(name, () => {
      expect(iso(nextWaiverRun(s, at(after)))).toBe(next)
      // and the inverse: the latest run AT the next instant is that instant
      expect(iso(lastWaiverRun(s, at(next)))).toBe(next)
      // one millisecond before it, the latest run is an earlier one
      expect(lastWaiverRun(s, new Date(at(next).getTime() - 1)).getTime()).toBeLessThan(at(next).getTime())
    })
  }
  it('lastWaiverRun across the weekend gap: Monday reads the Saturday run', () => {
    expect(iso(lastWaiverRun(DAILY, at('2026-11-02T20:00:00.000Z')))).toBe('2026-10-31T16:00:00.000Z')
  })
  it('lastFreeAgencyOpen: league 1’s Sunday 06:00 Pacific, on the fall-back Sunday (PST) and the one before (PDT)', () => {
    expect(iso(lastFreeAgencyOpen(DAILY, at('2026-11-02T20:00:00.000Z')))).toBe('2026-11-01T14:00:00.000Z')
    expect(iso(lastFreeAgencyOpen(DAILY, at('2026-11-01T13:59:59.000Z')))).toBe('2026-10-25T13:00:00.000Z')
  })
  it('refuses an empty day set and a malformed time loudly', () => {
    expect(() => nextWaiverRun({ ...DAILY, waiver_run_days: [] }, at('2026-11-01T00:00:00Z'))).toThrow(/at least one run day/)
    expect(() => nextWaiverRun({ ...DAILY, waiver_run_time: '9:00' }, at('2026-11-01T00:00:00Z'))).toThrow(/HH:MM/)
  })
})

describe('freeAgencyWindow — Chris’s two leagues across the 2026 fall-back week (week 8)', () => {
  // Week 7's last game is stamped at its floor, Tue 2026-10-27 00:00 PDT (07:00Z);
  // week 8's at Tue 2026-11-03 00:00 PST (08:00Z) — ingestion's max(actual, floor).
  const WEEK7_END = at('2026-10-27T07:00:00.000Z')
  const WEEK8_END = at('2026-11-03T08:00:00.000Z')
  const win = (s: WaiverSchedule, when: string, resetAt: Date | null, pendingRunAt: Date | null = null, waiverType: WindowInput['waiverType'] = 'faab') =>
    freeAgencyWindow({ schedule: s, waiverType, resetAt, pendingRunAt, at: at(when) })

  it('league 1 (daily 9 AM, free agency Sunday 6 AM → the week’s end)', () => {
    // right after week 7 ends: back to claims only, the next run Tuesday 9 AM
    const tue = win(DAILY, '2026-10-27T08:00:00.000Z', WEEK7_END)
    expect([tue.freeAgencyOpen, tue.why, iso(tue.nextRunAt)]).toStrictEqual([false, 'awaiting_run', '2026-10-27T16:00:00.000Z'])
    // the Tuesday run has happened; the Sunday opening has not
    const tueRun = win(DAILY, '2026-10-27T16:00:00.000Z', WEEK7_END)
    expect([tueRun.freeAgencyOpen, tueRun.why]).toStrictEqual([false, 'before_opening_time'])
    // Sunday 05:59:59 PST — one second before the opening: claims only
    expect(win(DAILY, '2026-11-01T13:59:59.000Z', WEEK7_END).freeAgencyOpen).toBe(false)
    // AT Sunday 06:00 PST (the fall-back morning — 14:00Z, not 13:00Z): open
    const sun = win(DAILY, '2026-11-01T14:00:00.000Z', WEEK7_END)
    expect([sun.freeAgencyOpen, sun.why, iso(sun.lastOpenAt)]).toStrictEqual([true, 'open', '2026-11-01T14:00:00.000Z'])
    // Monday night, before the last game ends: still open
    expect(win(DAILY, '2026-11-03T07:59:59.000Z', WEEK7_END).freeAgencyOpen).toBe(true)
    // the week ends: claims only again until Tuesday 9 AM PST
    const done = win(DAILY, '2026-11-03T08:00:00.000Z', WEEK8_END)
    expect([done.freeAgencyOpen, done.why, iso(done.nextRunAt)]).toStrictEqual([false, 'awaiting_run', '2026-11-03T17:00:00.000Z'])
  })

  it('league 2 (weekly, Tuesday midnight Pacific, then free agency until the week’s end)', () => {
    expect(win(WEEKLY, '2026-10-27T12:00:00.000Z', WEEK7_END).why).toBe('awaiting_run')
    expect(win(WEEKLY, '2026-10-28T06:59:59.000Z', WEEK7_END).freeAgencyOpen).toBe(false)
    expect(win(WEEKLY, '2026-10-28T07:00:00.000Z', WEEK7_END).freeAgencyOpen).toBe(true) // AT the run
    expect(win(WEEKLY, '2026-11-02T20:00:00.000Z', WEEK7_END).freeAgencyOpen).toBe(true)
    // week 8 ends: claims only until the NEXT run — Wednesday 00:00 PST (08:00Z, an hour later in UTC)
    const ended = win(WEEKLY, '2026-11-03T08:00:00.000Z', WEEK8_END)
    expect([ended.freeAgencyOpen, iso(ended.nextRunAt)]).toStrictEqual([false, '2026-11-04T08:00:00.000Z'])
    expect(win(WEEKLY, '2026-11-04T07:59:59.000Z', WEEK8_END).freeAgencyOpen).toBe(false)
    expect(win(WEEKLY, '2026-11-04T08:00:00.000Z', WEEK8_END).freeAgencyOpen).toBe(true)
  })

  it('a run AT the reset instant counts (Q78: waivers run on schedule as the week closes)', () => {
    const reset = at('2026-10-28T07:00:00.000Z') // the week's end stamped exactly at league 2's run
    expect(win(WEEKLY, '2026-10-28T07:00:00.000Z', reset).freeAgencyOpen).toBe(true)
  })

  it('an opening AT the reset instant opens nothing (the week closed at that instant)', () => {
    const reset = at('2026-11-01T14:00:00.000Z')
    expect(win(DAILY, '2026-11-01T14:00:00.000Z', reset).why).toBe('awaiting_run')
  })

  it('after the draft every undrafted player waits for the first run after it', () => {
    // a Saturday-night draft (23:00 PDT): Sunday's opening comes before any run — claims only
    const draft = at('2026-09-06T06:00:00.000Z')
    expect(win(DAILY, '2026-09-06T13:00:00.000Z', draft).why).toBe('awaiting_run')
    expect(win(DAILY, '2026-09-08T15:59:59.000Z', draft).freeAgencyOpen).toBe(false)
    // the first run after the draft (Tue 9 AM) — the Sunday opening already passed since the draft
    expect(win(DAILY, '2026-09-08T16:00:00.000Z', draft).freeAgencyOpen).toBe(true)
    // league 2: the first run after a Saturday draft is Wednesday 00:00 PDT
    expect(win(WEEKLY, '2026-09-09T06:59:59.000Z', draft).freeAgencyOpen).toBe(false)
    expect(win(WEEKLY, '2026-09-09T07:00:00.000Z', draft).freeAgencyOpen).toBe(true)
  })

  it('once the processor tracks the league, a run counts only after it is SETTLED (no instant add beats the claims — E8)', () => {
    const due = at('2026-10-28T07:00:00.000Z')
    const pending = win(WEEKLY, '2026-10-28T07:00:30.000Z', WEEK7_END, due)
    expect([pending.freeAgencyOpen, pending.why, iso(pending.lastRunAt)]).toStrictEqual([false, 'run_pending', '2026-10-21T07:00:00.000Z'])
    // settled: the processor advanced the pending run to next week's
    const settled = win(WEEKLY, '2026-10-28T07:00:30.000Z', WEEK7_END, at('2026-11-04T08:00:00.000Z'))
    expect([settled.freeAgencyOpen, iso(settled.lastRunAt)]).toStrictEqual([true, '2026-10-28T07:00:00.000Z'])
  })

  it('no waivers is always free agency; a claims-only league never is; a fixture with no draft and no week end is open', () => {
    expect(win(WEEKLY, '2026-10-27T12:00:00.000Z', WEEK7_END, null, 'none_fcfs')).toStrictEqual({
      freeAgencyOpen: true,
      why: 'no_waivers',
      lastRunAt: null,
      lastOpenAt: null,
      nextRunAt: null,
    })
    expect(win({ ...WEEKLY, free_agency_opens: 'never' }, '2026-11-02T20:00:00.000Z', WEEK7_END).why).toBe('claims_only')
    expect(win(WEEKLY, '2026-10-27T12:00:00.000Z', null).freeAgencyOpen).toBe(true)
  })
})

describe('presets and words', () => {
  it('Chris’s two leagues match their presets; the default is the Wednesday preset; none_fcfs is no waivers; anything else is custom', () => {
    expect(matchWaiverPreset({ ...DAILY, waiver_type: 'faab' })).toBe('daily_weekend_free_agency')
    expect(matchWaiverPreset({ ...WEEKLY, waiver_type: 'rolling_priority' })).toBe('weekly_then_free_agency')
    expect(matchWaiverPreset({ ...DEFAULT_WAIVER_SCHEDULE, waiver_type: 'faab' })).toBe('standard_wednesday')
    expect(matchWaiverPreset({ ...DAILY, waiver_type: 'none_fcfs' })).toBe('no_waivers')
    expect(matchWaiverPreset({ ...WEEKLY, waiver_run_time: '00:30', waiver_type: 'faab' })).toBeNull()
    // the opening day/time is ignored unless free agency opens at a day and time
    expect(matchWaiverPreset({ ...WEEKLY, free_agency_open_day: 'fri', waiver_type: 'faab' })).toBe('weekly_then_free_agency')
  })
  it('canonical weekdays are Sunday-first, de-duplicated', () => {
    expect(canonicalWeekdays(['sat', 'tue', 'sun', 'tue'])).toStrictEqual(['sun', 'tue', 'sat'])
  })
  it('describes each shape in plain words', () => {
    expect(describeWaiverSchedule({ ...WEEKLY, waiver_type: 'faab' })).toBe(
      'Waivers run Wednesday at 12:00 AM (America/Los_Angeles); free agency is open from the waiver run until the week’s last game ends.',
    )
    expect(describeWaiverSchedule({ ...DAILY, waiver_run_days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], free_agency_opens: 'never', waiver_type: 'faab' })).toBe(
      'Waivers run every day at 9:00 AM (America/Los_Angeles); there is no free agency — every pickup is a waiver claim.',
    )
    expect(describeWaiverSchedule({ ...DAILY, waiver_type: 'none_fcfs' })).toMatch(/^No waivers/)
  })
})
