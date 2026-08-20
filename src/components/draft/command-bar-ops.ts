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
 * honest attribution would need. Recorded in PROGRESS D176. (The M2 pause
 * overlay used to make the same disclaimer in its own copy — DR.7/D155
 * retired that copy, so the system post is now the ONE attribution site.)
 *
 * DR.7 (spec §16.3 say-a-thing-once; §16.5.4's v2.12 note — the bar is the
 * room's banner surface) added two arms:
 *   - `lobby` — the pre-start room state (DR.7(4)). The bar renders for the
 *     lobby too (Q12: the lobby shares the live surface), but nothing RUNS
 *     yet: no Pause/Resume (there is no clock to freeze), no Draft Options
 *     (§8.7's controls act on a draft in flight — the lobby's own
 *     commissioner affordances, Start draft now + Draft setup, stay in the
 *     lobby card). Status: "Draft scheduled" — the one telling of the
 *     phase; the countdown itself stays the lobby card's §16.5.1 hero.
 *   - `reconnecting` — the §16.5.4 realtime-fallback state, moved INTO the
 *     bar (DR.7(3)): same `connection === 'reconnecting'` trigger the M2
 *     board-zone banner used, one strip instead of a stack. Orthogonal to
 *     the status words (a paused room can drop its channel too), so it is
 *     its own field, not a statusText arm.
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
  /** Pre-start lobby (DR.7(4)). Real drafts only — a mock is born live
   *  (§8.8), so no caller can be both `lobby` and `isMock`. */
  lobby?: boolean
  /** `connection === 'reconnecting'` from `useDraftRoom` (DR.7(3)) — the
   *  live room's wire; the lobby keeps its shipped no-banner posture. */
  reconnecting?: boolean
  /** The FETCH path's twin of `reconnecting` (L.C3.1, PROGRESS F56's room
   *  half): the room holds last-good data and cannot refresh it
   *  (`room-health-ops.ts` → `'degraded'`). Orthogonal to both the status
   *  words and the channel state — a room can be paused, connected AND
   *  unable to refetch — so it is its own field, like `reconnecting`. */
  stale?: boolean
}

export interface CommandBarModel {
  variant: CommandBarVariant
  /** The pause/resume control's action, or null when the viewer may not
   *  pause (member; mock non-launcher; anyone in the lobby — nothing runs
   *  pre-start). The predicate — commissioner on a real draft, the LAUNCHER
   *  on a mock (R272; 069/071's mock-launcher arm) — lives HERE since
   *  DR.7/D155 retired the overlay's Resume button: the bar is the one
   *  place the legal caller acts. */
  pauseResume: 'pause' | 'resume' | null
  /** Draft Options (the §8.7 door) — commissioner on a REAL, RUNNING draft
   *  only (§8.7's controls act on a draft in flight — no door pre-start). */
  draftOptions: boolean
  /** The reduced launcher-only practice menu (delete-and-exit). */
  practiceOptions: boolean
  /** MOCK identity chip (D154: the banner is absorbed into the bar). */
  mockBadge: boolean
  /** The status in words — one authoritative line (§16.3 say-it-once). */
  statusText: string
  /** The §16.5.4 realtime-fallback state, rendered IN the bar (DR.7(3)). */
  reconnecting: boolean
  /** The §16.5.4 DEGRADED state (fetch path), rendered IN the bar (F56). */
  stale: boolean
  /** Exit Draft is unconditional (Q13 ruling: everyone can leave). */
  exit: true
}

export function commandBarModel(input: CommandBarInput): CommandBarModel {
  const { isMock, isMockLauncher, paused } = input
  const lobby = input.lobby ?? false
  // D110(1): a commissioner in a mock is NOT a commissioner.
  const commissioner = input.commishRole && !isMock

  const variant: CommandBarVariant = isMock
    ? 'mock'
    : commissioner
      ? 'commissioner'
      : 'member'

  const canPauseResume = !lobby && (commissioner || (isMock && isMockLauncher))

  return {
    variant,
    pauseResume: canPauseResume ? (paused ? 'resume' : 'pause') : null,
    draftOptions: commissioner && !lobby,
    practiceOptions: isMock && isMockLauncher && !lobby,
    mockBadge: isMock,
    statusText: lobby
      ? 'Draft scheduled'
      : isMock
        ? paused
          ? 'Practice paused'
          : 'Practice live'
        : paused
          ? 'Draft paused'
          : 'Draft live',
    reconnecting: input.reconnecting ?? false,
    stale: input.stale ?? false,
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
  /** Pre-start lobby (DR.7(4)): no clock runs yet, so the away-path
   *  sentence would be false — but the D94 auto-start is worth stating. */
  lobby?: boolean
  /** Lobby arm only (R396): `draft_scheduled_at` is set. The lobby is
   *  REACHABLE with no schedule (the league is `scheduled` but no instant
   *  is stored — `draft-lobby.tsx`'s no-countdown sub-state), and the D94
   *  auto-start promise ("it still starts on schedule") is false there;
   *  that arm gets the honest commissioner-starts-it sentence. */
  hasSchedule?: boolean
}): string {
  if (input.lobby) {
    // Pre-start: leaving costs nothing NOW; the honest warning is what
    // happens without you — the D94 auto-start when an instant is stored,
    // the commissioner's Start-now when none is (R396).
    return input.hasSchedule
      ? "Leave the lobby — the draft hasn't started. It still starts on schedule whether or not you're here."
      : "Leave the lobby — the draft hasn't started. The commissioner can start it whether or not you're here."
  }
  if (input.isMock && input.hasSeat) {
    return 'Leave the room — your practice pauses automatically and keeps for 72 hours.'
  }
  if (!input.isMock && input.hasSeat) {
    return "Leave the room — after a short grace, your picks are made from your Targets while you're away. Come back anytime to take over again."
  }
  // No seat (a spectator, or a mock that is not yours): leaving costs nothing.
  return 'Leave the room and head back to the league.'
}
