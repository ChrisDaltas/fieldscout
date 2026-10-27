/**
 * The manager's own "Auto-draft me" switch — spec §8.4 ("Managers can toggle
 * 'Auto-draft me' (e.g., if they have to leave). Commissioner can toggle it
 * for any team."), surfaced as the design's **Auto-pick** switch in the
 * Targets panel header (FieldScout Draft Room.dc.html, the Queue panel).
 * Pure ops for `my-queue.tsx`; the write is `useToggleAutodraft`
 * (`POST /api/leagues/[id]/draft/autodraft` → 072/168's
 * `set_team_autodraft`, the SELF path).
 *
 * WHAT THE FLAG DOES — measured from the tick, not assumed (068 ARM 2, the
 * same arm in every later tick body through 097): it is ONE flag,
 * `league_members.is_autodraft`, shared with the commissioner's any-team
 * switch in Draft Options. The server never picks early because of it. At
 * the deadline, an `is_autodraft` seat is autopicked AT ONCE — it skips the
 * D102 disconnect grace hold a stale (away) seat would otherwise get. In an
 * auction the same rule covers the NOMINATION clock (§8.6.2's system
 * nomination runs the seat's own Targets-first chain); nobody is ever bid
 * for (§8.6.5). With no pick clock (§8.2's untimed snake/linear draft)
 * there is no deadline, so the flag has nothing to act on. The copy below
 * says exactly that and no more.
 *
 * WHO GETS IT: a seated manager on a REAL league draft, for his own seat
 * only. Mocks never read the flag (068's mock branch hard-codes FALSE), and
 * a league-attached mock flipping it would change the REAL league seat — so
 * a practice room shows no switch. A commissioner "acting as" another team
 * (F524) is looking at THAT team's Targets; this switch is his own seat's,
 * so it steps aside (his any-team switch stays in Draft Options).
 */

export interface AutoPickControl {
  /** The league whose seat the switch writes (never null — no league, no
   *  switch). */
  leagueId: string
  /** The server's value (`league_members.is_autodraft`), read from the
   *  league detail — refreshed after my own toggle and whenever a system
   *  post lands (a commissioner flipping it for me — R271). */
  on: boolean
  isAuction: boolean
  /** A snake/linear draft with no pick clock (§8.2 soft timer). */
  untimed: boolean
}

export interface SelfAutoPickInput {
  isMock: boolean
  leagueId: string | null
  /** The viewer's seat in this draft (null = no seat). */
  myTeamId: string | null
  userId: string | null
  /** F524: the Targets panel shows ANOTHER team's Targets right now. */
  actingForAnother: boolean
  members: ReadonlyArray<{
    user_id: string | null
    team_id: string | null
    is_autodraft: boolean | null
  }>
  isAuction: boolean
  /** `drafts.config.pick_timer_seconds` as stored (unknown-typed JSON). */
  pickTimerSeconds: unknown
}

/** The switch's inputs, or `null` when this viewer has no switch to show. */
export function selfAutoPickControl(input: SelfAutoPickInput): AutoPickControl | null {
  if (input.isMock) return null
  if (input.leagueId === null) return null
  if (input.myTeamId === null || input.userId === null) return null
  if (input.actingForAnother) return null
  const seat = input.members.find(
    (m) => m.user_id === input.userId && m.team_id === input.myTeamId,
  )
  if (!seat) return null
  return {
    leagueId: input.leagueId,
    on: seat.is_autodraft === true,
    isAuction: input.isAuction,
    untimed: !input.isAuction && input.pickTimerSeconds === 0,
  }
}

/** The one line beside the switch — what it does, in a manager's words.
 *  ONE short line, like the design's Queue-header caption (Draft Room's
 *  "Drafts top of queue on auto-pick", nowrap + ellipsis): it must fit
 *  beside the switch at phone width, so the full story (the server acts at
 *  the deadline, never early; nobody is ever bid for) lives in the header
 *  comment above, not on screen. */
export function autoPickCaption(control: Pick<AutoPickControl, 'isAuction' | 'untimed'>): string {
  if (control.isAuction) return 'Nominates from Targets when time’s up'
  if (control.untimed) return 'No pick clock, so it won’t pick'
  return 'Picks from Targets when time’s up'
}

/** What the switch shows: the value being sent while a toggle is in flight,
 *  the server's value otherwise (a failed toggle falls back on its own). */
export function autoPickShown(serverOn: boolean, pendingValue: boolean | undefined): boolean {
  return pendingValue ?? serverOn
}
