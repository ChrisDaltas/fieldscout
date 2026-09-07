/**
 * Pure ops for the League settings panel (the `*-ops.ts` pattern — no React,
 * no DOM; pinned by `settings-panel-ops.test.ts`).
 *
 * `DIVISION_OPTIONS` — spec §7.3.1 `divisions` row, v2.16.12 (Q30 RULED (d),
 * Chris 2026-09-02): divisions are CUT from v1. The setting stays in the
 * catalog (Zod keeps its 1–2 parse range so stored rows stay valid — PROGRESS
 * F221's return path is additive), the schedule engine IGNORES the value
 * (migration 110, pinned in pgTAP 058), and the select renders EXACTLY ONE
 * option. This constant is the one home of that pin (tasks-M4 L.D1.2 item 1,
 * R719/R723): when divisions return, the option list grows here and the
 * engine's ignore-pin flips in the same change.
 */
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

export const DIVISION_OPTIONS = [1] as const

/** `{value,label}` list for the Divisions select — the same shape `numOptions` builds. */
export function divisionSelectOptions(): ReadonlyArray<{ value: string; label: string }> {
  return DIVISION_OPTIONS.map((v) => ({ value: String(v), label: String(v) }))
}

/**
 * Q39 (C) — spec §7.3.1 / §11.7 v2.16.25 (RULED by Chris 2026-09-07; migration
 * 118): a total-points league has NO playoff bracket — the season-long points
 * race IS its playoff. The Playoff-teams select is DISABLED under
 * `schedule_mode = 'total_points'` and its hint says why; switching the
 * schedule to total-points writes `playoff_teams: 0` in the SAME patch so the
 * form never holds a value the validator (and the DB) refuse.
 */
export const PLAYOFF_TEAMS_TOTAL_POINTS_HINT =
  'Total-points leagues have no bracket — the season-long points race is the playoff.'
export const PLAYOFF_TEAMS_DEFAULT_HINT = '0 = points-only champion.'

export function playoffTeamsControl(scheduleMode: LeagueSettings['schedule_mode']): { disabled: boolean; hint: string } {
  return scheduleMode === 'total_points'
    ? { disabled: true, hint: PLAYOFF_TEAMS_TOTAL_POINTS_HINT }
    : { disabled: false, hint: PLAYOFF_TEAMS_DEFAULT_HINT }
}

/** The settings patch for a schedule-mode change — total-points carries `playoff_teams: 0` with it. */
export function scheduleModePatch(mode: LeagueSettings['schedule_mode']): Partial<LeagueSettings> {
  return mode === 'total_points' ? { schedule_mode: mode, playoff_teams: 0 } : { schedule_mode: mode }
}
