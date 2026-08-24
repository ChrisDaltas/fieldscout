/**
 * Mock-launcher view derivations (M2 task L.B3.5; spec §8.8 launch/lifecycle,
 * §16.2 `mock-draft-launcher`, §16.5.2 mock-workflow row, §22.5 caps; D103/
 * D110). Pure — colocated ops split (the D82(4)/L.A2.x precedent).
 *
 * Authorization/validation all live in `create_mock_draft`/`delete_mock_draft`
 * (071) — these derivations only decide what the launcher RENDERS: the seat
 * options, the cap messaging, and the resume/recap card labels. The one
 * client-side cap read (3 active) exists so the launch button can be honest
 * BEFORE a refused round-trip — a PARTIAL read: it sees THIS league's actives
 * only, while 071 counts per-user across all leagues (see
 * `launchDisabledReason` — R280); the hourly cap is deliberately server-only
 * (creation instants of deleted mocks are invisible to the client — D110(6))
 * and its refusal surfaces verbatim.
 */

import type { MockDraftSummary } from '@/hooks/use-mock-drafts'

// ---------------------------------------------------------------------------
// Caps (§22.5 — the RPC enforces; these mirror its printed numbers for copy)
// ---------------------------------------------------------------------------

/** §22.5: active (live|paused) mocks per user — complete recaps don't count. */
export const MOCK_ACTIVE_CAP = 3
/** §22.5: mock creations per user per hour (server-counted — D110(6)). */
export const MOCK_HOURLY_CAP = 5

/** The standing cap line the launcher prints (§16.5.2 "3-active cap
 *  message" + the hourly half so the server's refusal never surprises). */
export const MOCK_CAP_NOTE = `Up to ${MOCK_ACTIVE_CAP} practice drafts running at once, ${MOCK_HOURLY_CAP} launches per hour.`

/** §8.8: abandoned (paused) mocks auto-expire. The half that is true of the
 *  ACTIVE list on every surface, whatever the finished ones are called. */
export const MOCK_PAUSED_EXPIRY_NOTE =
  'A paused practice draft keeps for 72 hours of inactivity, then cleans itself up.'

/**
 * The league launcher's combined note — the sentence above plus the kept-recap
 * half (§8.8: finished recaps never expire).
 *
 * **Composed, not restated, and deliberately NOT used on `/app/mocks` (R517).**
 * A standalone mock's finished state is a *report*, not a *recap* (D241(7)), so
 * printing this second sentence there would put both words on one screen — the
 * one-voice rule broken by the very constant that carries the rule's other
 * half. The practice home prints `MOCK_PAUSED_EXPIRY_NOTE` alone.
 */
export const MOCK_EXPIRY_NOTE = `${MOCK_PAUSED_EXPIRY_NOTE} Finished recaps stay until you delete them.`

/**
 * Why the launch button is disabled, or null when launching is offered.
 * ONLY the 3-active cap gets a client-side pre-flight — and a PARTIAL one
 * (R280): the count the caller passes comes from the launcher's league-scoped
 * GET, while 071's cap counts the user's active mocks across ALL leagues
 * (071:338–343 — no league filter). Cross-league actives are invisible here,
 * so this check can under-count, never over-block: when it misses, the RPC's
 * verbatim refusal is the authority (as it is for every other refusal —
 * hourly cap, league status, seat validity).
 */
export function launchDisabledReason(activeCount: number): string | null {
  if (activeCount >= MOCK_ACTIVE_CAP) {
    return `You already have ${MOCK_ACTIVE_CAP} practice drafts running — finish or delete one to start another.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Seat picker (§8.8: "their real seat by default (any seat selectable)")
// ---------------------------------------------------------------------------

export interface MockSeatOption {
  teamId: string
  name: string
  /** The launcher's own franchise — the picker's default. */
  isMine: boolean
}

export interface SeatTeamInput {
  id: string
  name: string
  status?: string | null
}

interface SeatMemberInput {
  user_id: string | null
  team_id: string | null
}

/**
 * Selectable seats: every NON-retired franchise (071's exact filter — a
 * placeholder or another member's franchise is legal; the mock human driver
 * is launcher-keyed, never seat-owner-keyed — D103(2)). The launcher's own
 * franchise is flagged so the picker defaults to it.
 */
export function mockSeatOptions(
  teams: readonly SeatTeamInput[],
  members: readonly SeatMemberInput[],
  userId: string | null,
): MockSeatOption[] {
  const myTeamId =
    (userId && members.find((m) => m.user_id === userId)?.team_id) || null
  return teams
    .filter((t) => t.status !== 'retired')
    .map((t) => ({ teamId: t.id, name: t.name, isMine: t.id === myTeamId }))
}

/** The picker's default: the launcher's real seat, else the first seat
 *  (a member with no franchise must still pick one — 071 refuses a NULL
 *  seat for the teamless with its own friendly message). */
export function defaultMockSeatId(options: readonly MockSeatOption[]): string | null {
  return options.find((o) => o.isMine)?.teamId ?? options[0]?.teamId ?? null
}

// ---------------------------------------------------------------------------
// Resume / recap card labels (§16.5.2 mock-workflow row)
// ---------------------------------------------------------------------------

/** "Paused · pick 37 of 96" — the resumable card's progress line. A mock
 *  with no derivable total still states its position honestly. */
export function mockProgressLabel(row: MockDraftSummary, teamCount: number | null): string {
  const state = row.status === 'paused' ? 'Paused' : 'Live'
  const pick = row.current_pick_number
  if (pick === null) return state
  const total =
    teamCount !== null && teamCount > 0 && row.total_rounds !== null
      ? teamCount * row.total_rounds
      : null
  return total !== null
    ? `${state} · pick ${pick} of ${total}`
    : `${state} · pick ${pick}`
}

// ---------------------------------------------------------------------------
// Seat counts — the denominator of the progress line, from two sources
// ---------------------------------------------------------------------------

/** A league mock's seat count: the league's non-retired franchises, the
 *  same filter `mockSeatOptions` uses. Extracted so the three `MockRow`
 *  mounts pass a NUMBER rather than a whole `LeagueDetail` — the practice
 *  home has no league to hand it (MP.5). */
export function activeSeatCount(teams: readonly SeatTeamInput[]): number {
  return teams.filter((t) => t.status !== 'retired').length
}

/**
 * A STANDALONE mock's seat count, read off the row itself: 095 stores the
 * bot `teams` ids it minted at `config.mock.cpu_seats`, one per opponent, so
 * the board is `cpu_seats.length + 1` — the human's own seat is the `+ 1`
 * and is not in that array (095's loop runs `1..team_count - 1`).
 *
 * Derived rather than selected because it is already stored: `cpu_seats` is
 * the DELETE authority for cleanup (D227(4)), not a field invented for this.
 *
 * NULL for a league-attached mock — 095 deliberately writes no `cpu_seats`
 * key there (a league mock mints nothing, so it stores nothing) — and null
 * is the honest answer: `mockProgressLabel` then prints the position with no
 * total instead of a made-up one.
 */
export function standaloneSeatCount(row: MockDraftSummary): number | null {
  const config = row.config as { mock?: { cpu_seats?: unknown } } | null
  const seats = config?.mock?.cpu_seats
  if (!Array.isArray(seats) || seats.length === 0) return null
  return seats.length + 1
}

/** The denominator for whichever shape the row is (MP.5). A league row gets
 *  its league's seat count; a standalone row reads its own. */
export function mockSeatCount(
  row: MockDraftSummary,
  leagueTeams: readonly SeatTeamInput[] | null,
): number | null {
  if (leagueTeams !== null) {
    const count = activeSeatCount(leagueTeams)
    return count > 0 ? count : null
  }
  return standaloneSeatCount(row)
}
