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

/** §8.8: abandoned (paused) mocks auto-expire; finished recaps never do. */
export const MOCK_EXPIRY_NOTE =
  'A paused practice draft keeps for 72 hours of inactivity, then cleans itself up. Finished recaps stay until you delete them.'

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

interface SeatTeamInput {
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
