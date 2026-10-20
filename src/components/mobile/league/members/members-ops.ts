/**
 * The phone's Members screen, pure (gap list §4 item 106): what each seat
 * row offers, what its sheet lists, and the invite form's words. The rules
 * are desktop's `InvitePanel` row for row (`invite-panel-ops.ts` decides
 * which verbs a league state accepts) — the phone only moves each seat's
 * controls into a sheet, so the row keeps its team and @handle as doors.
 */
import { CREATOR_SEAT_NOTE, creatorSeatBlocked, type Seat } from '@/components/leagues/invite-panel-ops'
import type { SeatInviteMode } from '@/components/leagues/invite-panel-actions'

/** What a seat row's trailing control opens — or why it has none. */
export type SeatAction =
  /** A seated manager: roles, the commissioner transfer, remove. */
  | { kind: 'manage' }
  /** A team with no manager: invite by email or username, assign, or copy its own link. */
  | { kind: 'invite' }
  /** An invite is out: copy its link, or revoke it. */
  | { kind: 'pending' }
  /** Nothing to press here; `note` says why when it isn't obvious. */
  | { kind: 'none'; note: string | null }

/**
 * Desktop's per-row rules (`SeatRow` in `invite-panel.tsx`): only a
 * commissioner or co-commissioner is offered anything; your own seat has
 * only Leave (at the foot of the screen); the sitting commissioner's seat is
 * nobody's to change; a co-commissioner is told he can't touch the league
 * creator's seat (§7.2 anti-coup) instead of being refused.
 *
 * A team with no manager and an invite that's out are told apart only by
 * the invite rows — so until those have loaded (`invitesLoaded`) neither is
 * offered anything: a team whose invite is already out must not read as one
 * to invite to (no second invite started by mistake).
 */
export function seatAction(
  seat: Seat,
  ctx: { canManage: boolean; myRole: string | null; seatUserId: string | null; leagueOwnerId: string; invitesLoaded: boolean },
): SeatAction {
  if (!ctx.canManage || seat.isSelf) return { kind: 'none', note: null }
  if (seat.status === 'claimed') {
    if (seat.role === 'commissioner') return { kind: 'none', note: null }
    if (creatorSeatBlocked({ myRole: ctx.myRole, seatUserId: ctx.seatUserId, leagueOwnerId: ctx.leagueOwnerId })) {
      return { kind: 'none', note: CREATOR_SEAT_NOTE }
    }
    return { kind: 'manage' }
  }
  if (!ctx.invitesLoaded) return { kind: 'none', note: null }
  if (seat.status === 'invited' && seat.invite) return { kind: 'pending' }
  if (seat.status === 'placeholder' && seat.teamId) return { kind: 'invite' }
  return { kind: 'none', note: null }
}

/** The row's "more" control, said for a screen reader. */
export function seatActionLabel(kind: 'manage' | 'invite' | 'pending', teamName: string): string {
  if (kind === 'invite') return `Invite a manager to ${teamName}`
  if (kind === 'pending') return `The invite to ${teamName}`
  return `Manage ${teamName}`
}

export type ManageOptionKey = 'make_co' | 'make_manager' | 'transfer' | 'remove'

/** What a seated manager's sheet lists, in order: the one role change his
 *  role allows, the commissioner transfer (the sitting commissioner only —
 *  never a co-commissioner), then Remove. */
export function manageOptions(seat: Seat, myRole: string | null): Array<{ key: ManageOptionKey; label: string }> {
  const options: Array<{ key: ManageOptionKey; label: string }> = []
  if (seat.role === 'manager') options.push({ key: 'make_co', label: 'Make co-commissioner' })
  if (seat.role === 'co_commissioner') options.push({ key: 'make_manager', label: 'Make manager' })
  if (myRole === 'commissioner') options.push({ key: 'transfer', label: 'Make commissioner' })
  options.push({ key: 'remove', label: 'Remove manager' })
  return options
}

export interface InviteModeCopy {
  chip: string
  placeholder: string
  inputType: 'email' | 'text'
  ariaLabel: string
  button: string
  hint: string
}

/** The seat invite form, per way in (desktop's three chips; the phone says
 *  what each one does). */
export const INVITE_MODES: Record<SeatInviteMode, InviteModeCopy> = {
  email: {
    chip: 'Email',
    placeholder: 'manager@email.com',
    inputType: 'email',
    ariaLabel: 'Invite by email',
    button: 'Send invite',
    hint: 'New to FieldScout? Their signup pre-fills this email — no account needed first.',
  },
  username: {
    chip: 'Username',
    placeholder: '@username',
    inputType: 'text',
    ariaLabel: 'Invite by username',
    button: 'Send invite',
    hint: 'They get a notification with the invite.',
  },
  assign: {
    chip: 'Assign',
    placeholder: '@username',
    inputType: 'text',
    ariaLabel: 'Assign by username',
    button: 'Assign',
    hint: 'Puts them on this team right away — no invite to accept.',
  },
}

export const INVITE_MODE_ORDER: readonly SeatInviteMode[] = ['email', 'username', 'assign']

/** An invite's state line: when it runs out, or why it no longer works. */
export function inviteStatusLine(state: 'active' | 'revoked' | 'expired' | 'spent', expiresAt: string): string {
  if (state !== 'active') return `Invite ${state}`
  const expires = new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `Expires ${expires}`
}
