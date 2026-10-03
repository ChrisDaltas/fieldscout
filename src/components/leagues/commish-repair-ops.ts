/**
 * Re-pair a matchup after the season starts — the pure half (League UX
 * batch 5, Chris 2026-10-03). The console's Schedule group mounts it, only
 * while override mode is on; the verb is migration 130's
 * `commish_edit_schedule` (`POST …/commish/schedule`, `useCommishEditSchedule`).
 *
 * **Prevent, don't refuse.** Every choice the form offers is one 130 accepts,
 * read from the schedule the page already holds (130:382-470 / 130:500-525):
 *   - only a regular-season pairing (`regular` / `secondary`) with two teams
 *     that carries no result, no score and no override is offered;
 *   - a week is offered only when it has such a pairing;
 *   - a team is offered only when it is a seated franchise and its own game
 *     that week (the one it would leave) carries no score or result either;
 *   - the same team on both sides, or the pairing as it stands, disables Save.
 * The timing gates 130 lifts (a started week, a kicked-off game) are not
 * gates here. The server still decides — its refusal renders verbatim.
 */
import type { ScheduleMatchup } from '@/hooks/use-schedule'

import { EDIT_NO_CHANGE_COPY, EDIT_SELF_COPY, type TeamRef } from './schedule-view-ops'

export const REPAIR_TITLE = 'Re-pair a matchup'
export const REPAIR_BLURB =
  'Change who plays whom in any regular-season week, even one already under way. The teams it displaces are paired with each other so every team still plays once. It is recorded and posted to the league.'
export const REPAIR_NEEDS_OVERRIDE_COPY = 'Turn on override mode above to re-pair a matchup once the season has started.'
export const REPAIR_NOTHING_COPY = 'No matchup can be re-paired — every regular-season game already has a score or a result.'
export const REPAIR_SCORED_TEAM_TITLE = 'This team’s game that week already has a score — re-pairing would rewrite it.'

/** A pairing 130 will re-pair: regular season, two teams, no result / score / override. */
export function repairable(m: Pick<ScheduleMatchup, 'round_type' | 'away_team_id' | 'is_overridden' | 'result' | 'home_score' | 'away_score'>): boolean {
  if (m.round_type !== 'regular' && m.round_type !== 'secondary') return false
  if (m.away_team_id === null) return false
  if (m.is_overridden || m.result !== null) return false
  return (m.home_score ?? 0) === 0 && (m.away_score ?? 0) === 0
}

export interface RepairMatchupOption {
  id: string
  week: number
  roundType: string
  home: TeamRef
  away: TeamRef
}

function ref(id: string, names: ReadonlyMap<string, string>): TeamRef {
  return { id, name: names.get(id) ?? 'Unknown team' }
}

/** Every re-pairable matchup, by week (ascending). */
export function repairOptions(matchups: readonly ScheduleMatchup[], names: ReadonlyMap<string, string>): Map<number, RepairMatchupOption[]> {
  const out = new Map<number, RepairMatchupOption[]>()
  for (const m of [...matchups].sort((a, b) => a.week - b.week)) {
    if (!repairable(m)) continue
    const list = out.get(m.week) ?? []
    list.push({ id: m.id, week: m.week, roundType: m.round_type, home: ref(m.home_team_id, names), away: ref(m.away_team_id as string, names) })
    out.set(m.week, list)
  }
  // The week's main games first, then its second-opponent games.
  for (const list of out.values()) list.sort((a, b) => Number(a.roundType === 'secondary') - Number(b.roundType === 'secondary') || a.home.name.localeCompare(b.home.name))
  return out
}

/**
 * Whether a team may be seated in `target` — false (with why) when the team
 * would have to leave a game that already carries a score or result, or has
 * no game that week to leave (130 refuses both by name).
 */
export function teamSeatable(
  teamId: string,
  target: Pick<RepairMatchupOption, 'id' | 'week' | 'roundType' | 'home' | 'away'>,
  matchups: readonly ScheduleMatchup[],
): { ok: true } | { ok: false; why: string } {
  if (teamId === target.home.id || teamId === target.away.id) return { ok: true }
  const sibling = matchups.find(
    (m) => m.week === target.week && m.round_type === target.roundType && m.id !== target.id && (m.home_team_id === teamId || m.away_team_id === teamId),
  )
  if (!sibling) return { ok: false, why: 'This team has no other game that week to move from.' }
  if (sibling.is_overridden || sibling.result !== null || (sibling.home_score ?? 0) !== 0 || (sibling.away_score ?? 0) !== 0) {
    return { ok: false, why: REPAIR_SCORED_TEAM_TITLE }
  }
  return { ok: true }
}

/** What stops Save (null = nothing): the form's own rules, before any round trip. */
export function repairProblem(
  target: RepairMatchupOption | null,
  home: string,
  away: string,
  matchups: readonly ScheduleMatchup[],
): string | null {
  if (!target) return 'Pick a matchup to re-pair.'
  if (!home || !away) return 'Pick both teams.'
  if (home === away) return EDIT_SELF_COPY
  if (home === target.home.id && away === target.away.id) return EDIT_NO_CHANGE_COPY
  for (const id of [home, away]) {
    const seat = teamSeatable(id, target, matchups)
    if (!seat.ok) return seat.why
  }
  return null
}

/** The matchup picker's words for one pairing. */
export function repairMatchupLabel(m: Pick<RepairMatchupOption, 'home' | 'away' | 'roundType'>): string {
  return `${m.home.name} vs ${m.away.name}${m.roundType === 'secondary' ? ' (second game)' : ''}`
}
