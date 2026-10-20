import { describe, expect, it } from 'vitest'

import { NAMES, SCHEDULE, matchup } from '@/components/leagues/standings-schedule.fixtures'
import type { RemixProposedRow } from '@/hooks/use-schedule'
import type { CommishEditScheduleResult } from '@/lib/leagues/api/commish-schedule-service'

import { editAppliedCopy, editWeek, remixWeekCards, repairAppliedCopy, repairTeamOptions, wantsScheduleEdit } from './commish-ops'

describe('wantsScheduleEdit — the member Schedule page’s door lands on the edit list', () => {
  it('is true only for #schedule-edit', () => {
    expect(wantsScheduleEdit('#schedule-edit')).toBe(true)
    for (const hash of ['', '#', '#schedule', 'schedule-edit', null, undefined]) expect(wantsScheduleEdit(hash), String(hash)).toBe(false)
  })
})

describe('editWeek — which upcoming week the edit list shows', () => {
  const weeks = [{ week: 3 }, { week: 4 }, { week: 5 }]
  it('the first upcoming week until one is picked', () => {
    expect(editWeek(weeks, null)).toBe(3)
    expect(editWeek(weeks, 5)).toBe(5)
  })
  it('falls back to the first when the picked week can no longer change (it started)', () => {
    expect(editWeek(weeks, 2)).toBe(3)
  })
  it('null with no week left to change', () => {
    expect(editWeek([], 3)).toBeNull()
  })
})

describe('remixWeekCards — the preview’s redrawn weeks as cards', () => {
  const row = (week: number, home: string, away: string, regenerated = true): RemixProposedRow => ({ week, round_type: 'regular', home_team_id: home, away_team_id: away, regenerated })
  it('keeps only the redrawn weeks, each pairing marked against today’s, with its count', () => {
    const current = [
      ...SCHEDULE.matchups,
      matchup({ id: 'm6', week: 3, home_team_id: 't2', away_team_id: 't3' }),
    ]
    const proposed = [
      // Week 2 is live — kept (not regenerated).
      row(2, 't1', 't3', false),
      row(2, 't2', 't4', false),
      // Week 3: one pairing new, one the same teams with home and away swapped.
      row(3, 't1', 't2'),
      row(3, 't4', 't3'),
    ]
    const cards = remixWeekCards({ proposed }, current, NAMES)
    expect(cards.map((c) => c.week)).toEqual([3])
    expect(cards[0]!.changed).toBe(2)
    expect(cards[0]!.pairings.map((p) => [p.text, p.state])).toEqual([
      ['Alpha vs Bravo', 'changed'],
      ['Delta vs Charlie', 'changed'],
    ])
  })
  it('a pairing kept as it is reads unchanged, one with sides swapped reads flipped', () => {
    const current = [matchup({ id: 'a', week: 5, home_team_id: 't1', away_team_id: 't2' }), matchup({ id: 'b', week: 5, home_team_id: 't3', away_team_id: 't4' })]
    const cards = remixWeekCards({ proposed: [row(5, 't1', 't2'), row(5, 't4', 't3')] }, current, NAMES)
    expect(cards[0]!.pairings.map((p) => p.state)).toEqual(['same', 'flipped'])
    expect(cards[0]!.changed).toBe(1)
  })
})

describe('the words a finished change shows', () => {
  it('an upcoming week’s edit names the new pairing', () => {
    expect(editAppliedCopy({ week: 3, matchup: { matchup_id: 'm5', before: { home_team_id: 't1', away_team_id: 't4' }, after: { home_team_id: 't1', away_team_id: 't2' } } }, NAMES)).toBe('Week 3: Alpha vs Bravo.')
  })
  it('a re-pair names the new pairing, or says why nothing changed', () => {
    const base = {
      week: 2,
      matchup: { matchup_id: 'm4', before: { home_team_id: 't2', away_team_id: 't4' }, after: { home_team_id: 't3', away_team_id: 't4' } },
      no_changes: false,
      no_changes_why: null,
    } as unknown as CommishEditScheduleResult
    expect(repairAppliedCopy(base, NAMES)).toEqual({ title: 'Matchup re-paired.', detail: 'Week 2: Charlie vs Delta.' })
    expect(repairAppliedCopy({ ...base, no_changes: true, no_changes_why: 'That is already the pairing.' }, NAMES)).toEqual({ title: 'Nothing changed.', detail: 'That is already the pairing.' })
  })
})

describe('repairTeamOptions — who may be seated in a re-pair (prevent, don’t refuse)', () => {
  const teams = [...NAMES].map(([id, name]) => ({ id, name }))
  it('greys out a team whose game that week already has a score, saying so; the two teams in the game stay', () => {
    // Week 2: Alpha–Charlie is scored; Bravo–Delta (m4) is re-paired here, unscored.
    const matchups = SCHEDULE.matchups.map((m) => (m.id === 'm4' ? { ...m, status: 'scheduled', home_score: null, away_score: null } : m))
    const target = { id: 'm4', week: 2, roundType: 'regular', home: { id: 't2', name: 'Bravo' }, away: { id: 't4', name: 'Delta' } }
    expect(repairTeamOptions(teams, target, matchups)).toEqual([
      { value: 't1', label: 'Alpha — game already scored', disabled: true },
      { value: 't2', label: 'Bravo', disabled: false },
      { value: 't3', label: 'Charlie — game already scored', disabled: true },
      { value: 't4', label: 'Delta', disabled: false },
    ])
  })
  it('a team with no game that week to leave can’t be seated either', () => {
    const matchups = [matchup({ id: 'x', week: 7, home_team_id: 't1', away_team_id: 't2' })]
    const target = { id: 'x', week: 7, roundType: 'regular', home: { id: 't1', name: 'Alpha' }, away: { id: 't2', name: 'Bravo' } }
    expect(repairTeamOptions(teams, target, matchups).find((o) => o.value === 't3')).toEqual({ value: 't3', label: 'Charlie — no game to move from', disabled: true })
  })
})
