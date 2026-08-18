/**
 * Command-bar view model (spec §16.4 zone 1; tasks-DR DR.2, D154) — the pure
 * variant/control derivation for `draft-command-bar.tsx`, pinned by a golden
 * table in `command-bar-ops.test.ts`.
 *
 * D154's three variants, derived here and nowhere else:
 *   - **commissioner** — Pause/Resume + Draft Options + status + Exit.
 *   - **member**       — status + Exit.
 *   - **mock**         — MOCK identity + status + Exit for everyone; the
 *     LAUNCHER (`config.mock.launched_by`) additionally gets Pause/Resume
 *     practice and the reduced Practice-options menu (delete-and-exit —
 *     the shipped `delete_mock_draft` verb, launcher-only in-RPC).
 *
 * D110(1) is enforced HERE as well as at the call site: `commissioner`
 * requires `!isMock`, so a caller passing a commissioner role into a mock
 * still gets the mock variant with NO Draft Options — "no commissioner
 * control becomes reachable on a mock". `draft-room.tsx` computes the same
 * thing at its `isCommish` site (`canUseCommishPanel(detail.my_role) &&
 * !draft.is_mock`); both layers must agree, and the golden table carries the
 * commissioner-in-a-mock case that would catch either one drifting.
 *
 * Status words: the paused arm says "Draft paused" WITHOUT the spec's
 * illustrative "by @commish" attribution — `drafts` carries `paused_at` but
 * no `paused_by` (verified against `src/types/database.ts`; WHO paused is
 * the D97 system post in chat), and DR §4.5 forbids the data-layer change
 * honest attribution would need. Same posture as the pause overlay's "who
 * paused it is posted in the draft chat". Recorded in PROGRESS D166.
 */

export type CommandBarVariant = 'commissioner' | 'member' | 'mock'

export interface CommandBarInput {
  /** The ROLE check alone (`canUseCommishPanel(my_role)`) — NOT the room's
   *  already-mock-masked `isCommish`; the mask is re-applied here so the
   *  model is safe even for a caller that forgot it (D110(1)). */
  commishRole: boolean
  isMock: boolean
  /** `config.mock.launched_by === userId` — always false on a real draft. */
  isMockLauncher: boolean
  paused: boolean
}

export interface CommandBarModel {
  variant: CommandBarVariant
  /** The pause/resume control's action, or null when the viewer may not
   *  pause (member; mock non-launcher). */
  pauseResume: 'pause' | 'resume' | null
  /** Draft Options (the §8.7 door) — commissioner on a REAL draft only. */
  draftOptions: boolean
  /** The reduced launcher-only practice menu (delete-and-exit). */
  practiceOptions: boolean
  /** MOCK identity chip (D154: the banner is absorbed into the bar). */
  mockBadge: boolean
  /** The status in words — one authoritative line (§16.3 say-it-once). */
  statusText: string
  /** Exit Draft is unconditional (Q13 ruling: everyone can leave). */
  exit: true
}

export function commandBarModel(input: CommandBarInput): CommandBarModel {
  const { isMock, isMockLauncher, paused } = input
  // D110(1): a commissioner in a mock is NOT a commissioner.
  const commissioner = input.commishRole && !isMock

  const variant: CommandBarVariant = isMock
    ? 'mock'
    : commissioner
      ? 'commissioner'
      : 'member'

  const canPauseResume = commissioner || (isMock && isMockLauncher)

  return {
    variant,
    pauseResume: canPauseResume ? (paused ? 'resume' : 'pause') : null,
    draftOptions: commissioner,
    practiceOptions: isMock && isMockLauncher,
    mockBadge: isMock,
    statusText: isMock
      ? paused
        ? 'Practice paused'
        : 'Practice live'
      : paused
        ? 'Draft paused'
        : 'Draft live',
    exit: true,
  }
}

/**
 * Exit Draft's honest copy (Q13 / §16.4 zone 1: "the control says what it
 * does"). Leaving fires the D102 heartbeat AWAY path only — never
 * `league_members.is_autodraft` — so the copy promises exactly that:
 * Targets-fed autopicks while away, manual control back on return. A mock
 * auto-pauses instead (E59) and keeps for 72h (071's expiry).
 */
export function exitDraftCopy(input: {
  isMock: boolean
  /** Viewer holds a seat in this draft (`myTeamId` non-null — on a mock,
   *  only the LAUNCHER holds the human seat, D103(2)). */
  hasSeat: boolean
}): string {
  if (input.isMock && input.hasSeat) {
    return 'Leave the room — your practice pauses automatically and keeps for 72 hours.'
  }
  if (!input.isMock && input.hasSeat) {
    return "Leave the room — after a short grace, your picks are made from your Targets while you're away. Come back anytime to take over again."
  }
  // No seat (a spectator, or a mock that is not yours): leaving costs nothing.
  return 'Leave the room and head back to the league.'
}
