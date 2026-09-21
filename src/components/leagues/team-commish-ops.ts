/**
 * team-commish-ops.ts — the PURE half of the team page's commissioner tools
 * and of BOTH rename arms (M6A task L.E1.13; spec §15.4:1694-1695 + the
 * v2.16.39 rename erratum, §10.3; PROGRESS §3 STANDING RULE (h), D346, D351,
 * F344, Q66; tasks-M6A §4 rule 15 / R971).
 *
 * Nothing here moves a player or names a team — every word below is a
 * rendering of a field 127's / 128's result documents already carry
 * (`commish-roster-service.ts`, `commish-team-service.ts`,
 * `team-rename-service.ts`). `team-commish-tools.tsx` owns the hooks; this
 * owns the words and the decisions that must be pinnable without a browser.
 *
 * THERE IS NO REASON ANYWHERE IN THIS FILE, ON PURPOSE (Q66, spec v2.16.41;
 * F343): the commissioner is never prompted and the request carries none.
 */
import type { CommishRosterOverrideResult } from '@/lib/leagues/api/commish-roster-service'
import type { CommishRenameTeamResult } from '@/lib/leagues/api/commish-team-service'
import type { RenameOwnTeamResult } from '@/lib/leagues/api/team-rename-service'

export const TEAM_TOOLS_TITLE = 'Commissioner roster tools'
export const TEAM_TOOLS_INTRO =
  'Move a player to another team, drop one, or add a free agent to this roster. These walk past game-day locks, waivers and acquisition limits — and say so. Roster size and one-team-per-player still apply to you. Every change is recorded and posted to the league.'
export const TEAM_TOOLS_EMPTY_ROSTER_COPY = 'This roster is empty — there is nobody to move or drop. You can still add a player below.'

/**
 * F344 / tasks-M6A L.E1.13 item 3b — THE BADGE COPY, WIDENED WITH THE FLAG.
 * `team_lineups.edited_by_commish` meant "a commissioner SET this lineup";
 * since migration 127 (D346) a commissioner roster move that evicts a
 * starter also sets it, on a week the MANAGER set himself. The decision
 * (the task says: decide and say which): THE WORDS WIDEN, the badge does
 * not move to another signal — a second signal is a migration plus a worker
 * change (D346's stated cost), and the flag's new meaning is true of both
 * cases. So the badge no longer claims the commissioner SET the lineup; it
 * says he CHANGED it, and the title says what that can mean.
 */
export const COMMISH_CHANGED_BADGE = '✸ changed by commissioner'
export const COMMISH_CHANGED_TITLE =
  'The commissioner changed this week’s lineup — by setting it, or by a roster move that took a player out of a starting slot. The details are in League Home’s activity.'

// ---------------------------------------------------------------------------
// The roster verbs' consequence copy — §4 rule 15: never a bare "Saved."
// ---------------------------------------------------------------------------

export type RosterOutcomeBranch = 'no_changes' | 'score_not_followed' | 'saved'

export interface ToolOutcome<B extends string> {
  branch: B
  tone: 'positive' | 'caution' | 'neutral'
  text: string
}

type RosterOutcomeFields = Pick<CommishRosterOverrideResult, 'no_changes' | 'no_changes_why' | 'score_stale' | 'score_stale_reason'>

export const ROSTER_SAVED_COPY = 'Saved — the roster changed, any lineup slot it emptied is open, and the move is recorded and posted to the league.'

/**
 * Which sentence a roster result earns. ORDER IS THE CONTRACT:
 *  1. `no_changes` is its own state and must NOT say "saved" — nothing was
 *     written, no receipt, no post; 127 says WHY as a field and it is shown.
 *  2. `score_stale` comes FIRST among the "it saved" branches (R971 / §4
 *     rule 15): the roster moved and the SCORE did not follow — the reason is
 *     127's own, rendered, never swallowed.
 *  3. Then the plain save.
 */
export function rosterOutcome(result: RosterOutcomeFields): ToolOutcome<RosterOutcomeBranch> {
  if (result.no_changes) {
    return {
      branch: 'no_changes',
      tone: 'neutral',
      text: `Nothing changed, so nothing was recorded and nothing was posted${result.no_changes_why ? ` — ${result.no_changes_why}` : ''}.`,
    }
  }
  if (result.score_stale) {
    return {
      branch: 'score_not_followed',
      tone: 'caution',
      text: `Saved — but this week’s score has NOT caught up with the move${result.score_stale_reason ? `: ${result.score_stale_reason}` : ''}.`,
    }
  }
  return { branch: 'saved', tone: 'positive', text: ROSTER_SAVED_COPY }
}

/**
 * `bypassed[]` rendered back in words (item 1: *"this move walked past the
 * game-day lock for 2 players"*). 127's vocabulary (`131:1757-1794`):
 * `e32_drop_lock:<player>` / `e32_add_lock:<player>` (the game-day lock, one
 * entry per player), `waiver_period:<player>`, `acquisitions_per_week`,
 * `acquisitions_per_season`. A name this file does not know is printed AS
 * IS — never dropped (a bypass nobody was told about is the defect).
 * Null when the move walked past nothing.
 */
export function rosterBypassedCopy(bypassed: readonly string[] | null | undefined): string | null {
  if (!bypassed || bypassed.length === 0) return null
  let locks = 0
  const parts: string[] = []
  for (const name of bypassed) {
    if (name.startsWith('e32_drop_lock:') || name.startsWith('e32_add_lock:')) locks += 1
    else if (name.startsWith('waiver_period:')) parts.push('the waiver period')
    else if (name === 'acquisitions_per_week') parts.push('the weekly acquisition limit (not counted against it)')
    else if (name === 'acquisitions_per_season') parts.push('the season acquisition limit (not counted against it)')
    else parts.push(name)
  }
  if (locks > 0) parts.unshift(`the game-day lock for ${locks} ${locks === 1 ? 'player' : 'players'}`)
  return `This move walked past ${parts.join(', ')}.`
}

// ---------------------------------------------------------------------------
// Rename — the manager's arm and the commissioner's
// ---------------------------------------------------------------------------

/** Which door a viewer's rename goes through — or none.
 *  - INSIDE override mode a commissioner's rename is the AUDITED verb, on any
 *    team, his own included (rule (h); §3(a) — any action, any team).
 *  - OUTSIDE it, a team's own manager renames through his own door (he is
 *    exercising no §10.1 power — item 2), commissioner or not.
 *  - Anyone else has no rename here. A commissioner on another team's page
 *    outside the mode is told the mode is the way, never shown a dead control. */
export type RenameArm = 'commissioner' | 'manager' | null

export function renameArm(args: { isCommish: boolean; isOwnTeam: boolean; overrideMode: boolean }): RenameArm {
  if (args.isCommish && args.overrideMode) return 'commissioner'
  if (args.isOwnTeam) return 'manager'
  return null
}

export const RENAME_VIA_OVERRIDE_HINT = 'To rename this team, turn on override mode below.'

export type RenameGate = { ok: true; name: string } | { ok: false; why: string }

/** Why Save is disabled, SAID (rule (h)). 128's bound: trimmed, non-empty,
 *  ≤ 100. An UNCHANGED name is NOT gated — the verb answers `no_changes`. */
export function renameGate(draft: string): RenameGate {
  const name = draft.trim()
  if (name === '') return { ok: false, why: 'Type a team name to save.' }
  if (name.length > 100) return { ok: false, why: `A team name is at most 100 characters — this one is ${name.length}.` }
  return { ok: true, name }
}

export type RenameOutcomeBranch = 'no_changes' | 'renamed_name_shared' | 'renamed'

type RenameFields =
  | Pick<CommishRenameTeamResult, 'no_changes' | 'name' | 'name_collides_with'>
  | Pick<RenameOwnTeamResult, 'no_changes' | 'name' | 'name_collides_with'>

/**
 * `no_changes` never says "renamed"; a name another team already carries is
 * MEASURED by 128, never refused, and is said FIRST among the success arms.
 * `audited` picks the closing clause: the commissioner's rename is recorded
 * and posted, the manager's own is neither (128 reports `audited: false`).
 */
export function renameOutcome(result: RenameFields, audited: boolean): ToolOutcome<RenameOutcomeBranch> {
  if (result.no_changes) {
    return { branch: 'no_changes', tone: 'neutral', text: `Nothing changed — this team is already called ${result.name}.` }
  }
  const tail = audited
    ? ' The rename is recorded and posted to the league; earlier records keep the name they were written with.'
    : ' Earlier records keep the name they were written with.'
  const shared = Array.isArray(result.name_collides_with) && result.name_collides_with.length > 0
  if (shared) {
    return {
      branch: 'renamed_name_shared',
      tone: 'caution',
      text: `Renamed to ${result.name} — another team in this league already uses that name, so the two will read the same on every page.${tail}`,
    }
  }
  return { branch: 'renamed', tone: 'positive', text: `Renamed to ${result.name}.${tail}` }
}

// ---------------------------------------------------------------------------
// The add picker
// ---------------------------------------------------------------------------

export const ADD_SEARCH_MIN = 2
export const ADD_SEARCH_HINT = 'Type at least two letters of a player’s name.'
export const ADD_NO_MATCH_COPY = 'No available player matches — everyone by that name is already on a roster in this league.'
export const ADD_RESULT_LIMIT = 8

export interface AddCandidate {
  id: string
  full_name: string
  position: string
  team: string | null
}

/** The players a force-add may name: the search window minus everyone a
 *  roster in THIS league already holds (one team per player is a LEGALITY
 *  gate — it binds the commissioner, 127 refuses it by name; offering them
 *  would be a Save that can only be refused). Window order kept; capped. */
export function addCandidates(players: readonly AddCandidate[], heldPlayerIds: ReadonlySet<string>): AddCandidate[] {
  return players.filter((p) => !heldPlayerIds.has(p.id)).slice(0, ADD_RESULT_LIMIT)
}
