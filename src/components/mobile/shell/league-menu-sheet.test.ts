import { describe, expect, it } from 'vitest'

import { draftResultsDate, playoffWeeks } from './league-menu-sheet'

describe('playoffWeeks — the Menu’s Playoffs value', () => {
  it('spans one round per halving of the field', () => {
    expect(playoffWeeks({ playoff_teams: 6, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Weeks 15–17')
    expect(playoffWeeks({ playoff_teams: 4, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Weeks 15–16')
    expect(playoffWeeks({ playoff_teams: 4, playoff_start_week: 13, playoff_weeks_per_round: 2 })).toBe('Weeks 13–16')
    expect(playoffWeeks({ playoff_teams: 2, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Week 15')
  })
  it('says None without playoffs, and nothing before the settings load', () => {
    expect(playoffWeeks({ playoff_teams: 0, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('None')
    expect(playoffWeeks(undefined)).toBeUndefined()
  })
})

describe('draftResultsDate — the Menu’s Draft results date (handoff §2.5 F: "Aug 30")', () => {
  const NY = 'America/New_York'
  const before = (scheduledAt: string | null, active: { started_at: string | null; scheduled_at: string | null } | null = null) => ({
    active_draft: active,
    settings: { draft: { draft_scheduled_at: scheduledAt } },
  })

  it('a finished draft shows the day it actually ran — not the time that had been saved for it', () => {
    const ran = { started_at: '2026-08-30T23:00:00Z', completed_at: '2026-08-31T01:10:00Z' }
    expect(draftResultsDate(ran, before('2026-08-28T23:00:00Z'), NY)).toBe('Aug 30')
    // No start on record: the day it finished.
    expect(draftResultsDate({ started_at: null, completed_at: '2026-08-31T01:10:00Z' }, before(null), 'UTC')).toBe('Aug 31')
  })

  it('in the viewer’s own time zone', () => {
    // 10 PM on Aug 30 on the East Coast is already Aug 31 in UTC.
    const lateNight = { started_at: '2026-08-31T02:00:00Z', completed_at: null }
    expect(draftResultsDate(lateNight, before(null), NY)).toBe('Aug 30')
    expect(draftResultsDate(lateNight, before(null), 'UTC')).toBe('Aug 31')
  })

  it('a draft under way shows the day it started; one not started yet, the league’s saved draft day', () => {
    expect(draftResultsDate(null, before('2026-08-28T23:00:00Z', { started_at: '2026-08-29T00:30:00Z', scheduled_at: '2026-08-28T23:00:00Z' }), 'UTC')).toBe('Aug 29')
    expect(draftResultsDate(null, before('2026-08-28T23:00:00Z', { started_at: null, scheduled_at: '2026-08-28T23:00:00Z' }), NY)).toBe('Aug 28')
    expect(draftResultsDate(null, before('2026-09-02T00:00:00Z'), NY)).toBe('Sep 1')
  })

  it('no draft date: no date (never a made-up one)', () => {
    expect(draftResultsDate(null, before(null), NY)).toBeUndefined()
    expect(draftResultsDate(null, { active_draft: null, settings: {} }, NY)).toBeUndefined()
    expect(draftResultsDate({ started_at: null, completed_at: null }, before('2026-08-28T23:00:00Z'), NY)).toBeUndefined()
    expect(draftResultsDate(null, before('not a date'), NY)).toBeUndefined()
  })

  it('nothing until both reads are in — a saved time never flashes up before the day it really ran', () => {
    expect(draftResultsDate(undefined, before('2026-08-28T23:00:00Z'), NY)).toBeUndefined()
    expect(draftResultsDate(null, undefined, NY)).toBeUndefined()
  })
})
