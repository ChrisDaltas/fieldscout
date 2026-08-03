import { describe, expect, it } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { LEAGUE_SETTINGS_DEFAULTS } from '@/lib/leagues/settings/league-settings'

import {
  checklistProgress,
  deriveSetupChecklist,
  describeDraftTime,
  draftCountdown,
  formatInstantAtOffset,
  homeStateForStatus,
  laterStatusLabel,
  offsetLabel,
  parseIsoOffsetMinutes,
  seatCounts,
} from './league-home-states-ops'

// ---------------------------------------------------------------------------
// Fixture — a minimal but real-shaped LeagueDetail the home reads
// ---------------------------------------------------------------------------

function member(over: Partial<LeagueDetail['members'][number]>): LeagueDetail['members'][number] {
  return {
    id: over.id ?? 'm1',
    user_id: over.user_id ?? null,
    team_id: over.team_id ?? null,
    role: over.role ?? 'manager',
    is_placeholder: over.is_placeholder ?? null,
    is_autodraft: over.is_autodraft ?? null,
    joined_at: over.joined_at ?? null,
    profiles: over.profiles ?? null,
  }
}

function detail(over: {
  status?: string
  max_teams?: number
  scoring_system_id?: string | null
  draft_scheduled_at?: string | null
  members?: LeagueDetail['members']
  teams?: LeagueDetail['teams']
}): LeagueDetail {
  const settings = structuredClone(LEAGUE_SETTINGS_DEFAULTS)
  settings.draft.draft_scheduled_at = over.draft_scheduled_at ?? null
  return {
    league: {
      id: 'lg-1',
      name: 'Test League',
      avatar_url: null,
      description: null,
      season: 2026,
      status: over.status ?? 'setup',
      owner_id: 'owner-1',
      scoring_system_id: over.scoring_system_id ?? null,
      invite_code: 'code123',
      invite_slug: null,
      max_teams: over.max_teams ?? 12,
      created_at: null,
      updated_at: null,
    },
    settings,
    members: over.members ?? [],
    teams: over.teams ?? [],
    my_role: 'commissioner',
  }
}

// ---------------------------------------------------------------------------
// status → state (§16.5.1)
// ---------------------------------------------------------------------------

describe('homeStateForStatus', () => {
  it('maps M1 statuses to their heroes', () => {
    expect(homeStateForStatus('setup')).toBe('setup')
    expect(homeStateForStatus('scheduled')).toBe('scheduled')
  })

  it('routes every later lifecycle status to the "not yet" placeholder', () => {
    // The §7.1 six-state enum past scheduled — never a mock hero (task item 1).
    for (const s of ['drafting', 'in_season', 'playoffs', 'complete']) {
      expect(homeStateForStatus(s)).toBe('later')
    }
  })

  it('falls through unknown statuses to "later" (never crashes the home)', () => {
    expect(homeStateForStatus('banana')).toBe('later')
    expect(homeStateForStatus('')).toBe('later')
  })
})

describe('laterStatusLabel', () => {
  it('labels each later status', () => {
    expect(laterStatusLabel('drafting')).toBe('Draft in progress')
    expect(laterStatusLabel('in_season')).toBe('In season')
    expect(laterStatusLabel('playoffs')).toBe('Playoffs')
    expect(laterStatusLabel('complete')).toBe('Season complete')
    expect(laterStatusLabel('mystery')).toBe('Coming soon')
  })
})

// ---------------------------------------------------------------------------
// seats n/N
// ---------------------------------------------------------------------------

describe('seatCounts', () => {
  it('counts claimed members against max_teams; placeholders are open', () => {
    const d = detail({
      max_teams: 12,
      members: [
        member({ id: 'm1', user_id: 'u1', team_id: 't1' }), // claimed
        member({ id: 'm2', user_id: 'u2', team_id: 't2' }), // claimed
        member({ id: 'm3', user_id: null, team_id: 't3', is_placeholder: true }), // placeholder → open
      ],
    })
    expect(seatCounts(d)).toEqual({ filled: 2, total: 12, open: 10 })
  })

  it('never returns a negative open count (over-seated is clamped)', () => {
    const d = detail({
      max_teams: 1,
      members: [
        member({ id: 'm1', user_id: 'u1' }),
        member({ id: 'm2', user_id: 'u2' }),
      ],
    })
    expect(seatCounts(d).open).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// setup checklist (§16.5.1 setup row)
// ---------------------------------------------------------------------------

describe('deriveSetupChecklist', () => {
  it('a fresh solo league: settings ✓, seats/scoring/schedule incomplete', () => {
    const d = detail({
      max_teams: 12,
      scoring_system_id: null,
      draft_scheduled_at: null,
      members: [member({ id: 'm1', user_id: 'u1', team_id: 't1', role: 'commissioner' })],
    })
    const items = deriveSetupChecklist(d)
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))

    expect(byKey.settings.done).toBe(true)
    expect(byKey.seats.done).toBe(false)
    expect(byKey.seats.detail).toBe('1 / 12 seats filled')
    expect(byKey.scoring.done).toBe(false)
    expect(byKey.schedule.done).toBe(false)
    expect(checklistProgress(items)).toEqual({ done: 1, total: 4 })
  })

  it('a fully-set league: all four items complete', () => {
    const members = Array.from({ length: 12 }, (_, i) =>
      member({ id: `m${i}`, user_id: `u${i}`, team_id: `t${i}` }),
    )
    const d = detail({
      max_teams: 12,
      scoring_system_id: 'espn-standard',
      draft_scheduled_at: '2026-08-30T23:00:00.000Z',
      members,
    })
    const items = deriveSetupChecklist(d)
    expect(items.every((i) => i.done)).toBe(true)
    expect(checklistProgress(items)).toEqual({ done: 4, total: 4 })
  })

  it('reads the draft instant from the NESTED path, not top-level (D60(4))', () => {
    // A top-level draft_scheduled_at must NOT satisfy the schedule item — the
    // contract stores it at settings.draft.draft_scheduled_at only.
    const d = detail({ draft_scheduled_at: null })
    ;(d.settings as unknown as Record<string, unknown>).draft_scheduled_at =
      '2026-08-30T23:00:00.000Z'
    const schedule = deriveSetupChecklist(d).find((i) => i.key === 'schedule')!
    expect(schedule.done).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// draft countdown (§16.5.1 scheduled row)
// ---------------------------------------------------------------------------

describe('draftCountdown', () => {
  const target = Date.parse('2026-08-30T23:00:00.000Z')

  it('breaks the remaining time into d/h/m/s', () => {
    // 1 day, 2 hours, 3 minutes, 4 seconds before the draft.
    const now = target - ((1 * 86_400 + 2 * 3600 + 3 * 60 + 4) * 1000)
    const cd = draftCountdown('2026-08-30T23:00:00.000Z', now)!
    expect(cd).toMatchObject({ isPast: false, days: 1, hours: 2, minutes: 3, seconds: 4 })
    expect(cd.targetMs).toBe(target)
  })

  it('clamps to zero and flags isPast at and after the instant', () => {
    const at = draftCountdown('2026-08-30T23:00:00.000Z', target)!
    expect(at).toMatchObject({ isPast: true, remainingMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0 })

    const after = draftCountdown('2026-08-30T23:00:00.000Z', target + 5000)!
    expect(after.isPast).toBe(true)
    expect(after.remainingMs).toBe(0)
  })

  it('one second before the instant is NOT past (boundary)', () => {
    const cd = draftCountdown('2026-08-30T23:00:00.000Z', target - 1000)!
    expect(cd.isPast).toBe(false)
    expect(cd).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 1 })
  })

  it('returns null for an unparseable instant', () => {
    expect(draftCountdown('not-a-date', target)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// timezone display (§16.4)
// ---------------------------------------------------------------------------

describe('parseIsoOffsetMinutes', () => {
  it('reads Z as UTC and explicit offsets as signed minutes', () => {
    expect(parseIsoOffsetMinutes('2026-08-30T23:00:00.000Z')).toBe(0)
    expect(parseIsoOffsetMinutes('2026-08-30T19:00:00-04:00')).toBe(-240)
    expect(parseIsoOffsetMinutes('2026-08-31T04:30:00+05:30')).toBe(330)
  })

  it('returns null when no offset is present', () => {
    expect(parseIsoOffsetMinutes('2026-08-30T23:00:00')).toBeNull()
  })
})

describe('offsetLabel', () => {
  it('formats offsets with the unicode minus and half-hour zones', () => {
    expect(offsetLabel(0)).toBe('UTC')
    expect(offsetLabel(-240)).toBe('UTC−4')
    expect(offsetLabel(330)).toBe('UTC+5:30')
  })
})

describe('formatInstantAtOffset', () => {
  const ms = Date.parse('2026-08-30T23:00:00.000Z')

  it('renders the wall-clock time at UTC', () => {
    expect(formatInstantAtOffset(ms, 0)).toBe('Sun, Aug 30, 2026 · 11:00 PM')
  })

  it('renders the same instant shifted into a western offset (crosses to 7 PM)', () => {
    expect(formatInstantAtOffset(ms, -240)).toBe('Sun, Aug 30, 2026 · 7:00 PM')
  })

  it('renders midnight as 12:00 AM (12-hour edge)', () => {
    const midnight = Date.parse('2026-01-01T00:00:00.000Z')
    expect(formatInstantAtOffset(midnight, 0)).toBe('Thu, Jan 1, 2026 · 12:00 AM')
  })
})

describe('describeDraftTime', () => {
  it('pairs the league-offset render with its label (UTC instant)', () => {
    expect(describeDraftTime('2026-08-30T23:00:00.000Z')).toEqual({
      leagueTime: 'Sun, Aug 30, 2026 · 11:00 PM',
      leagueOffset: 'UTC',
    })
  })

  it('renders at the scheduled offset when one is present', () => {
    expect(describeDraftTime('2026-08-30T19:00:00-04:00')).toEqual({
      leagueTime: 'Sun, Aug 30, 2026 · 7:00 PM',
      leagueOffset: 'UTC−4',
    })
  })

  it('returns null for an unparseable instant', () => {
    expect(describeDraftTime('nope')).toBeNull()
  })
})
