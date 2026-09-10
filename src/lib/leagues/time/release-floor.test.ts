import { describe, expect, it } from 'vitest'

import {
  nextPacificTuesdayMidnight,
  pacificOffsetMinutesAt,
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
