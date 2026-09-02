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

import { LEAGUE_SETTINGS_DEFAULTS, mergeSettings, splitSettings } from '@/lib/leagues/settings/league-settings'
import type { LeagueRow } from '@/lib/leagues/settings/league-settings'

import { DIVISION_OPTIONS, divisionSelectOptions } from './settings-panel-ops'

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
