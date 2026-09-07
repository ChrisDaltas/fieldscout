/**
 * settings-panel-ops — the Q30 (d) divisions pin (spec §7.3.1 v2.16.12;
 * tasks-M4 L.D1.2 item 1; R719/R723; PROGRESS F221).
 *
 * Two halves, each falsifiable on its own:
 *   1. the Divisions select renders EXACTLY ONE option, `1` — a stored
 *      literal, so restoring `[1, 2]` reds here by name;
 *   2. a league row that STORED `divisions: 2` (a pre-cut row, or a direct
 *      PATCH) still round-trips through `mergeSettings` without throwing —
 *      the Zod 1–2 parse range is deliberately KEPT (never-weaken on stored
 *      rows; F221's return path stays additive).
 */
import { describe, expect, it } from 'vitest'

import { LEAGUE_SETTINGS_DEFAULTS, mergeSettings, splitSettings, validateLeagueSettings } from '@/lib/leagues/settings/league-settings'
import type { LeagueRow } from '@/lib/leagues/settings/league-settings'

import {
  DIVISION_OPTIONS,
  PLAYOFF_TEAMS_DEFAULT_HINT,
  PLAYOFF_TEAMS_TOTAL_POINTS_HINT,
  divisionSelectOptions,
  playoffTeamsControl,
  scheduleModePatch,
} from './settings-panel-ops'

describe('DIVISION_OPTIONS — divisions pinned at 1 for v1 (Q30 (d))', () => {
  it('the option list is exactly [1] — a stored literal', () => {
    expect([...DIVISION_OPTIONS]).toStrictEqual([1])
  })

  it('the select options are exactly one row, value "1" / label "1"', () => {
    expect(divisionSelectOptions()).toStrictEqual([{ value: '1', label: '1' }])
  })

  it('a stored divisions: 2 row still merges and round-trips without throwing (Zod keeps 1–2 — F221)', () => {
    const { columns, blob } = splitSettings({ ...structuredClone(LEAGUE_SETTINGS_DEFAULTS), divisions: 2 })
    const row = { ...columns, settings: blob } as unknown as LeagueRow
    expect(() => mergeSettings(row)).not.toThrow()
    expect(mergeSettings(row).divisions).toBe(2)
  })

  it('…and the value the select cannot offer is still not the value the engine reads: divisions is absent from the typed columns (it rides the blob the engine ignores)', () => {
    const { columns, blob } = splitSettings({ ...structuredClone(LEAGUE_SETTINGS_DEFAULTS), divisions: 2 })
    expect('divisions' in columns).toBe(false)
    expect((blob as { divisions?: number }).divisions).toBe(2)
  })
})

describe('playoffTeamsControl / scheduleModePatch — Q39 (C): a total-points league has no bracket (spec §7.3.1 / §11.7 v2.16.25; migration 118)', () => {
  it('under total_points the Playoff-teams select is DISABLED and the hint says why', () => {
    expect(playoffTeamsControl('total_points')).toStrictEqual({ disabled: true, hint: PLAYOFF_TEAMS_TOTAL_POINTS_HINT })
    expect(PLAYOFF_TEAMS_TOTAL_POINTS_HINT).toBe('Total-points leagues have no bracket — the season-long points race is the playoff.')
  })

  it('under h2h it is enabled with the catalog hint', () => {
    expect(playoffTeamsControl('h2h')).toStrictEqual({ disabled: false, hint: PLAYOFF_TEAMS_DEFAULT_HINT })
  })

  it('switching the schedule to total-points writes playoff_teams 0 in the SAME patch — the form never holds a value the validator refuses', () => {
    expect(scheduleModePatch('total_points')).toStrictEqual({ schedule_mode: 'total_points', playoff_teams: 0 })
    const patched = { ...structuredClone(LEAGUE_SETTINGS_DEFAULTS), ...scheduleModePatch('total_points') }
    expect(validateLeagueSettings(patched).errors.filter((e) => e.field === 'playoff_teams')).toStrictEqual([])
  })

  it('switching back to h2h touches only the mode (playoff_teams is the user\'s to set)', () => {
    expect(scheduleModePatch('h2h')).toStrictEqual({ schedule_mode: 'h2h' })
  })
})
