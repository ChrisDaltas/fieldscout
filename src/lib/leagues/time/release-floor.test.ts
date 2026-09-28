import { describe, expect, it } from 'vitest'

import {
  nextPacificTuesdayMidnight,
  pacificOffsetMinutesAt,
  weekReleaseCeiling,
  weekReleaseFloor,
} from './release-floor'

/** The literal `nfl_weeks.starts_at` seeds from 039:63-83 — Wednesday 00:00
 *  ET, with the per-date offsets the migration itself writes (−04 through the
 *  2026-11-01 fall-back, −05 after). */
const SEEDED_STARTS_AT: ReadonlyArray<[week: number, startsAt: string]> = [
  [1, '2026-09-09T04:00:00.000Z'],
  [2, '2026-09-16T04:00:00.000Z'],
  [7, '2026-10-21T04:00:00.000Z'],
  [8, '2026-10-28T04:00:00.000Z'], // slate straddles the fall-back (Thu Oct 29 → Mon Nov 2)
  [9, '2026-11-04T05:00:00.000Z'],
  [18, '2027-01-06T05:00:00.000Z'],
]

describe('weekReleaseFloor — Q50(a): Tuesday 00:00 America/Los_Angeles, derived from the WEEK', () => {
  it('every 2026 seeded week floors on the Tuesday six days after its Wednesday starts_at', () => {
    const floors = SEEDED_STARTS_AT.map(([week, startsAt]) => [week, weekReleaseFloor(startsAt).toISOString()])
    expect(floors).toEqual([
      [1, '2026-09-15T07:00:00.000Z'],
      [2, '2026-09-22T07:00:00.000Z'],
      [7, '2026-10-27T07:00:00.000Z'],
      [8, '2026-11-03T08:00:00.000Z'],
      [9, '2026-11-10T08:00:00.000Z'],
      [18, '2027-01-12T08:00:00.000Z'],
    ])
  })

  it('CASE 3 (DST): the same floor is 07:00Z in week 7 and 08:00Z in week 8 — exactly 3600 s apart, from the zone rules', () => {
    // The 2026 US fall-back is Sunday 2026-11-01, INSIDE the season. Week 7's
    // floor is PDT (UTC−7), week 8's is PST (UTC−8). A hard-coded 07:00Z
    // releases week 8 an hour EARLY; a hard-coded 08:00Z releases week 7 an
    // hour LATE. Both violate Q50(a)'s "as people experience it".
    const wk7 = weekReleaseFloor('2026-10-21T04:00:00.000Z')
    const wk8 = weekReleaseFloor('2026-10-28T04:00:00.000Z')
    expect(wk8.getTime() - wk7.getTime()).toBe(7 * 24 * 3600_000 + 3600_000)
    expect((wk8.getTime() - wk7.getTime()) % (24 * 3600_000)).toBe(3600_000)
    expect(pacificOffsetMinutesAt(wk7)).toBe(420) // PDT
    expect(pacificOffsetMinutesAt(wk8)).toBe(480) // PST
    // Both are midnight on the Pacific wall clock — the invariant the offsets serve.
    for (const floor of [wk7, wk8]) {
      expect(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          hourCycle: 'h23',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(floor),
      ).toMatch(/^Tue,? 00:00$/)
    }
  })

  it('the Tuesday is STRICTLY after the anchor: starts_at renders as Tuesday ~21:00 PT, so the floor is the NEXT Tuesday', () => {
    // 2026-09-16T04:00Z is Tue Sep 15, 21:00 PDT. A `>=` comparison would
    // return Sep 15 00:00 PT — three hours BEFORE the week's own games.
    expect(weekReleaseFloor('2026-09-16T04:00:00.000Z').toISOString()).toBe('2026-09-22T07:00:00.000Z')
    // An anchor exactly ON a Tuesday midnight PT advances a full seven days.
    expect(nextPacificTuesdayMidnight(new Date('2026-09-22T07:00:00.000Z')).toISOString()).toBe(
      '2026-09-29T07:00:00.000Z',
    )
    // One millisecond earlier is that same Tuesday.
    expect(nextPacificTuesdayMidnight(new Date('2026-09-22T06:59:59.999Z')).toISOString()).toBe(
      '2026-09-22T07:00:00.000Z',
    )
  })

  it('refuses an unparseable starts_at rather than degrading to Invalid Date (a silent un-build of the ruling)', () => {
    expect(() => weekReleaseFloor('not a timestamp')).toThrow(/unparseable nfl_weeks.starts_at/)
  })
})

describe('weekReleaseCeiling — Q50 / Q78: Wednesday 00:00 America/Los_Angeles, the day after the floor', () => {
  // The SAME literals pgTAP 101 A4 pins on 153's week_release_ceiling_internal.
  it('every 2026 seeded week ceilings on the Wednesday after its floor (stored literals)', () => {
    const ceilings = SEEDED_STARTS_AT.map(([week, startsAt]) => [week, weekReleaseCeiling(startsAt).toISOString()])
    expect(ceilings).toEqual([
      [1, '2026-09-16T07:00:00.000Z'],
      [2, '2026-09-23T07:00:00.000Z'],
      [7, '2026-10-28T07:00:00.000Z'],
      [8, '2026-11-04T08:00:00.000Z'],
      [9, '2026-11-11T08:00:00.000Z'],
      [18, '2027-01-13T08:00:00.000Z'],
    ])
  })

  it('DST: 07:00Z in week 7 (PDT) and 08:00Z in week 8 (PST) — midnight Wednesday on the Pacific wall clock both times', () => {
    const wk7 = weekReleaseCeiling('2026-10-21T04:00:00.000Z')
    const wk8 = weekReleaseCeiling('2026-10-28T04:00:00.000Z')
    expect(wk8.getTime() - wk7.getTime()).toBe(7 * 24 * 3600_000 + 3600_000)
    expect(pacificOffsetMinutesAt(wk7)).toBe(420)
    expect(pacificOffsetMinutesAt(wk8)).toBe(480)
    for (const ceiling of [wk7, wk8]) {
      expect(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          hourCycle: 'h23',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(ceiling),
      ).toMatch(/^Wed,? 00:00$/)
    }
  })

  it('the spring-forward boundary too (2027-03-14): a week starting Wed 2027-03-10 00:00 EST ceilings at Wed 03-17 00:00 PDT = 07:00Z', () => {
    expect(weekReleaseFloor('2027-03-10T05:00:00.000Z').toISOString()).toBe('2027-03-16T07:00:00.000Z')
    expect(weekReleaseCeiling('2027-03-10T05:00:00.000Z').toISOString()).toBe('2027-03-17T07:00:00.000Z')
  })

  it('is exactly one Pacific day after the floor, and AFTER the next week starts (Wednesday 00:00 ET is three hours earlier)', () => {
    for (const [, startsAt] of SEEDED_STARTS_AT) {
      const floor = weekReleaseFloor(startsAt)
      expect(weekReleaseCeiling(startsAt).getTime() - floor.getTime()).toBe(24 * 3600_000)
    }
    // [week N starts_at, week N+1 starts_at] — the seeded pairs (039), across the fall-back.
    const successors: ReadonlyArray<[string, string]> = [
      ['2026-09-09T04:00:00.000Z', '2026-09-16T04:00:00.000Z'],
      ['2026-10-21T04:00:00.000Z', '2026-10-28T04:00:00.000Z'],
      ['2026-10-28T04:00:00.000Z', '2026-11-04T05:00:00.000Z'],
    ]
    for (const [startsAt, nextStartsAt] of successors) {
      expect(weekReleaseCeiling(startsAt).getTime() - new Date(nextStartsAt).getTime()).toBe(3 * 3600_000)
    }
  })

  it('never falls INSIDE the week it closes: a starts_at at any other wall time still ceilings after starts_at + 7 days (and within a day of it)', () => {
    // A Monday 23:00 Pacific anchor — the floor's weekday walk lands one hour
    // later, so a ceiling derived as "the floor's day after" would unlock
    // players 25 hours into the week. Anchored past the week's own seven days
    // it is the first Pacific midnight after Mon Oct 26 23:00 PDT.
    const odd = '2026-10-20T06:00:00.000Z' // Mon Oct 19 23:00 PDT
    expect(weekReleaseFloor(odd).toISOString()).toBe('2026-10-20T07:00:00.000Z')
    expect(weekReleaseCeiling(odd).toISOString()).toBe('2026-10-27T07:00:00.000Z')
    for (let h = 0; h < 7 * 24; h += 1) {
      const startsAt = new Date(Date.parse('2026-10-21T04:00:00.000Z') + h * 3600_000)
      const gap = weekReleaseCeiling(startsAt.toISOString()).getTime() - startsAt.getTime()
      expect(gap).toBeGreaterThan(7 * 24 * 3600_000)
      expect(gap).toBeLessThanOrEqual(8 * 24 * 3600_000 + 3600_000)
    }
  })

  it('refuses an unparseable starts_at (the floor\'s guard)', () => {
    expect(() => weekReleaseCeiling('not a timestamp')).toThrow(/unparseable nfl_weeks.starts_at/)
  })
})
