/**
 * "Acting as" — the commissioner's team picker in the draft room (F524;
 * spec §8.7 "act as manager", §10.3; PROGRESS D452 / D474). Pure — the
 * colocated ops split.
 *
 * The commissioner can do any manager act for a team he runs: bid for it in a
 * live auction (171's `draft_place_bid(p_team_id)`) and set its Targets (171's
 * `draft_queue_replace` arm, read through 178's `draft_queue_for_team`). Both
 * write a receipt for every real change. The picker is ONE room-level choice
 * — "the team I'm acting for" — shown where the acts happen (the auction
 * block's bid row and the Targets panel), so the bid box, the Targets list
 * and the pool's "add to Targets" never disagree about whose team it is.
 *
 * Where it shows (prevent, don't refuse — a control that renders and then
 * 403s is a defect): a commissioner or co-commissioner, on a REAL league
 * draft. Never on a mock (no commissioner, §8.8) nor a standalone practice.
 */

import { canUseCommishPanel } from './commish-panel-ops'

export interface ActingTeam {
  id: string
  name: string
}

/** The Select's value for "my own team" (Radix needs a non-empty string). */
export const MY_TEAM_VALUE = 'mine'

export interface ActingAsOption {
  value: string
  label: string
}

/** Who sees the picker. The routes and the RPCs re-check every call. */
export function canActForTeams(input: {
  isMock: boolean
  leagueId: string | null
  myRole: string | null | undefined
}): boolean {
  return !input.isMock && input.leagueId !== null && canUseCommishPanel(input.myRole)
}

/** The picker's options: his own team first (when he has a seat), then every
 *  other team by name. */
export function actingAsOptions(
  teams: ReadonlyArray<ActingTeam>,
  myTeamId: string | null,
): ActingAsOption[] {
  const mine = myTeamId ? teams.find((t) => t.id === myTeamId) : undefined
  const others = teams
    .filter((t) => t.id !== myTeamId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  return mine ? [{ value: MY_TEAM_VALUE, label: `My team (${mine.name})` }, ...others] : others
}

/** The team the room acts for: the picked team, else his own seat. */
export function actingTeamId(picked: string | null, myTeamId: string | null): string | null {
  return picked ?? myTeamId
}

/** True when the acts go to a team that is NOT his own seat — the receipted,
 *  commissioner arm (the request then carries `team_id`). */
export function isActingForAnother(picked: string | null, myTeamId: string | null): boolean {
  return picked !== null && picked !== myTeamId
}

/** The Select's value for a picked team. */
export function pickerValue(picked: string | null, myTeamId: string | null): string | undefined {
  if (picked === null || picked === myTeamId) return myTeamId ? MY_TEAM_VALUE : undefined
  return picked
}

/** The picked team from a Select value. */
export function pickedFromValue(value: string): string | null {
  return value === MY_TEAM_VALUE ? null : value
}

/** The Targets panel's title, in plain words. */
export function targetsTitle(actingForName: string | null): string {
  return actingForName ? `${actingForName}’s Targets` : 'My Targets'
}

/** The bid button, in plain words: "Bid $5" or "Bid $5 for Team 4". */
export function bidButtonLabel(amount: number, actingForName: string | null): string {
  return actingForName ? `Bid $${amount} for ${actingForName}` : `Bid $${amount}`
}
