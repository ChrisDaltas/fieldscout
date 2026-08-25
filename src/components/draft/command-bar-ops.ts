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
 *     practice and, since MS.5, the tools:
 *       - **league-attached** mock: the launcher gets **Draft Options**
 *         itself — the same door with the same name (§8.8 v2.15 / D259:
 *         the launcher is the commissioner of their own mock; D221(2)'s
 *         container ruling) — holding the MOCK catalog
 *         (`draft-options-ops.ts` MOCK_ENABLED_SECTIONS: clock + order),
 *         with *Delete practice & exit* joining its destructive group.
 *         The single-item Practice-options menu dissolves into it.
 *       - **standalone** mock: the reduced Practice-options menu
 *         (delete-and-exit) stays — NO control has a wire door there yet
 *         (F128: order; F129: clock), and a door holding no working
 *         control would lie about its contents (R515's rule one level up).
 *
 * D110(1)'s surviving half is enforced HERE as well as at the call site:
 * `commissioner` requires `!isMock`, so a commissioner role NEVER opens the
 * full catalog on a mock — a commissioner who is not the launcher gets
 * nothing at all (D103(2): nobody else drives a solo practice), and the
 * LAUNCHER's door comes from `isMockLauncher`, not from role.
 * `draft-room.tsx` computes the same predicate at its panel-mount site;
 * both layers must agree, and the golden table carries the
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
  /** `scope.leagueId === null` (MP.6c's standalone practice room). Only
   *  meaningful with `isMock` — the model ignores it on a real draft. It
   *  picks WHICH menu the launcher gets (MS.5): Draft Options when a
   *  league is attached (the enabled controls have wire doors there),
   *  Practice options when standalone (no door yet — F128/F129). */
  standalone?: boolean
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
  /** Draft Options (the §8.7 door) — commissioner on a REAL, RUNNING draft,
   *  or (MS.5) the LAUNCHER on a league-attached mock, where it holds the
   *  MOCK catalog (never pre-start — no door in the lobby). */
  draftOptions: boolean
  /** The reduced launcher-only practice menu (delete-and-exit) — STANDALONE
   *  mocks only since MS.5: on a league-attached mock the delete item lives
   *  in Draft Options' destructive group instead (D221(2)). */
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
  const standalone = input.standalone ?? false
  // D110(1): a commissioner in a mock is NOT a commissioner.
  const commissioner = input.commishRole && !isMock
  // MS.5 (§8.8 v2.15/D259): the LAUNCHER is the commissioner of their own
  // league-attached mock — the same Draft Options door opens for them,
  // holding the mock catalog. A STANDALONE practice has no wire door for
  // any control yet (F128/F129), so its launcher keeps the reduced
  // Practice-options menu — render what works, never a dead control (R515).
  const launcherTools = isMock && isMockLauncher && !standalone

  const variant: CommandBarVariant = isMock
    ? 'mock'
    : commissioner
      ? 'commissioner'
      : 'member'

  const canPauseResume = !lobby && (commissioner || (isMock && isMockLauncher))

  return {
    variant,
    pauseResume: canPauseResume ? (paused ? 'resume' : 'pause') : null,
    draftOptions: (commissioner || launcherTools) && !lobby,
    practiceOptions: isMock && isMockLauncher && standalone && !lobby,
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
