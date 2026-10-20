'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueInvites } from '@/hooks/use-league-invites'
import type { MemberRole, RemoveMode } from '@/hooks/use-league-members'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { InlineIssue } from './settings-form-controls'
import { Crest, TeamNameLink } from './league-cells'
import {
  ROLE_LABELS,
  copyByHandToast,
  copyWithToast,
  fillAllLabel,
  useFillSeats,
  useLeaveSeat,
  useRemoveSeat,
  useRevokeSeatInvite,
  useRoleChange,
  useRotateLink,
  useSeatInvite,
  useSlugActions,
  useTransferCommish,
  type SeatInviteMode,
} from './invite-panel-actions'
import {
  CREATOR_SEAT_NOTE,
  LEAVE_BLOCKED_NOTE,
  buildJoinLink,
  creatorSeatBlocked,
  defaultRemoveMode,
  deriveSeats,
  inviteState,
  leaveConfirms,
  leaveLeagueCopy,
  nextLeaveStep,
  memberControls,
  preferredShareCode,
  removeOptionCopy,
  type LeaveCopy,
  type LeaveStep,
  type MemberControls,
  type MembersPhase,
  type PendingInviteInput,
  type Seat,
} from './invite-panel-ops'

/**
 * Invite panel + seat list (M1 task L.A2.5; spec §7.2 email-first, §16.2
 * invite-panel, §16.4 identity display rule, §16.5.2 invite-workflow states,
 * §12.23 RLS, §22.5 rotation, D42 remove chooser).
 *
 * Wires the REAL L.A1.14/L.A1.15 surface (no RPC reimplemented, no route
 * added): the commissioner share link (always visible + copyable — the Q5 v1
 * minimum bar), the custom slug editor, the destructive "rotate link" affordance
 * (confirm dialog → `rotate_invite_code`), the seat list (open/invited/claimed/
 * placeholder) with email-first seat-targeted invites (username + copyable link
 * secondary) + revoke, placeholder-seat creation, the roles UI (promote/demote
 * + the atomic commissioner transfer), and the D42 remove chooser (takeover /
 * vacate — L.E1.42, Chris 2026-10-01: a team is never retired, "you can
 * change the manager but the Team lives"; PROGRESS D467).
 *
 * L.E1.39 (F539; PROGRESS D460): mounted in every league state — League Home
 * before the draft, the draft room's Draft Options, and the members page
 * after it — so each control is offered only where its verb accepts it in
 * THIS state (`memberControls`, measured per verb in `invite-panel-ops.ts`):
 * the share link and new seats before the draft only; seat invites, assign,
 * roles, takeover / vacate and leave in every state.
 *
 * Every action (and its toast) is `invite-panel-actions.ts`'s, shared with
 * the phone's Members screen (gap list §4 item 106) — one set of handlers,
 * two layouts.
 *
 * THE PRIVACY INVARIANT (§7.2/§12.23): the seat identity comes from
 * `deriveSeats` — a claimed seat renders *Team — @username* and
 * NEVER an email; `invited_email` shows only on a pending invited seat, where
 * the commissioner is meant to see it. The commissioner reads the invite rows
 * (email included) over the §12.23 RLS policy, but the render authority is the
 * ops layer, pinned in `invite-panel-ops.test.ts`.
 */
export function InvitePanel({
  leagueId,
  detail,
  linkTeams = true,
}: {
  leagueId: string
  detail: LeagueDetail
  /** Whether a seat's name is a door to that team's page. FALSE inside the
   *  LIVE draft room (`commish-draft-panel.tsx`), where a navigate-away
   *  affordance can pull a commissioner off the clock — the same hazard that
   *  keeps the board grid, the presence bar and the lobby unlinked. */
  linkTeams?: boolean
}) {
  const { user } = useAuth()
  const canManage = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'

  // Only the commissioner may read invite rows (RLS §12.23); don't fire the
  // query for a plain member (it would return an empty set anyway).
  const invitesQuery = useLeagueInvites(leagueId, canManage)

  // A stable "now" for expiry classification — computed once on mount (14-day
  // invites don't need a ticking clock). Never a wall-clock read in engine code
  // (this is UI), and passed into the pure ops so the tests stay deterministic.
  const [nowMs] = useState(() => Date.now())

  const model = deriveSeats(
    {
      teamCount: detail.settings.team_count,
      members: detail.members,
      teams: detail.teams,
      invites: invitesQuery.data ?? [],
      currentUserId: user?.id ?? null,
    },
    nowMs,
  )
  const controls = memberControls(
    detail.league.status,
    model.seats.some((s) => s.status === 'placeholder' || s.status === 'invited'),
  )

  return (
    <div className="flex flex-col gap-[19px]">
      {canManage && controls.shareLink && (
        <ShareLinkCard
          leagueId={leagueId}
          inviteCode={detail.league.invite_code}
          inviteSlug={detail.league.invite_slug}
        />
      )}

      <SeatsCard
        leagueId={leagueId}
        linkTeams={linkTeams}
        detail={detail}
        seats={model.seats}
        total={model.total}
        claimedCount={model.claimedCount}
        openCount={model.openCount}
        canManage={canManage}
        controls={controls}
        myRole={detail.my_role}
        nowMs={nowMs}
        invitesLoading={canManage && invitesQuery.isPending}
      />
    </div>
  )
}

// ===========================================================================
// Share link card (link + slug editor + rotate) — commissioner only
// ===========================================================================

function ShareLinkCard({
  leagueId,
  inviteCode,
  inviteSlug,
}: {
  leagueId: string
  inviteCode: string | null
  inviteSlug: string | null
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareCode = preferredShareCode(inviteSlug, inviteCode)
  const shareLink = shareCode ? buildJoinLink(origin, shareCode) : null

  return (
    <Card>
      <CardHeader className="min-h-0 border-b-0 px-4 pb-1.5 pt-3.5">
        <CardTitle className="text-[15px] font-bold tracking-[-0.02em]">Invite link</CardTitle>
        <RotateLinkButton leagueId={leagueId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5 px-4 pb-4 pt-1.5">
        <div className="space-y-1.5">
          <Label htmlFor="share-link" className="text-[11px] font-semibold">
            League share link
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="share-link"
              readOnly
              value={shareLink ?? 'No link yet'}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton
              text={shareLink}
              label="Invite link copied"
              disabled={!shareLink}
              ariaLabel="Copy the league share link"
            />
          </div>
          <p className="text-[10px] font-medium text-n-6">
            Anyone with this link can claim an open seat — paste it into any chat or email.
          </p>
        </div>

        <SlugEditor leagueId={leagueId} inviteSlug={inviteSlug} />
      </CardContent>
    </Card>
  )
}

/** Custom slug editor: type a slug → the share link becomes /join/<slug>. */
function SlugEditor({ leagueId, inviteSlug }: { leagueId: string; inviteSlug: string | null }) {
  const [value, setValue] = useState(inviteSlug ?? '')
  const [error, setError] = useState<string | null>(null)
  const slug = useSlugActions(leagueId)

  const trimmed = value.trim()
  const dirty = trimmed !== (inviteSlug ?? '')

  async function save() {
    setError(null)
    setError(await slug.save(trimmed))
  }

  async function clear() {
    setError(null)
    const problem = await slug.clear()
    if (problem) setError(problem)
    else setValue('')
  }

  return (
    <div className="space-y-1.5 border-t border-n-4 pt-3">
      <Label htmlFor="slug-input" className="text-[11px] font-semibold">
        Custom link
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-n-3">/join/</span>
        <Input
          id="slug-input"
          value={value}
          placeholder="your-league"
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          className="w-44"
        />
        <Button
          type="button"
          variant="stroke"
          size="sm"
          disabled={!dirty || slug.pending}
          onClick={save}
        >
          <Icon name="save" size={13} /> Save
        </Button>
        {inviteSlug && (
          <Button type="button" variant="ghost" size="sm" disabled={slug.pending} onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {error && <InlineIssue tone="error" message={error} />}
      <p className="text-[10px] font-medium text-n-6">
        Letters, numbers and hyphens. Survives a link rotation.
      </p>
    </div>
  )
}

/** Rotate = destructive: invalidates the current share code (old links stop
 *  working). Confirm dialog per §22.5; the custom slug survives. */
function RotateLinkButton({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  const rotate = useRotateLink(leagueId)

  async function confirm() {
    if (await rotate.rotate()) setOpen(false)
  }

  return (
    <>
      <Button type="button" variant="stroke" size="sm" onClick={() => setOpen(true)}>
        <Icon name="repeat" size={13} /> Rotate link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the invite link?</DialogTitle>
            <DialogDescription>
              This generates a new share code and <strong>invalidates the current one</strong> — any
              link already shared with that code will stop working. Your custom /join link (if set)
              keeps working. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="stroke" size="sm" onClick={() => setOpen(false)}>
              Keep the current link
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={rotate.pending}
              onClick={confirm}
            >
              {rotate.pending ? 'Rotating…' : 'Rotate link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ===========================================================================
// Seats card (the seat list)
// ===========================================================================

function SeatsCard({
  leagueId,
  detail,
  seats,
  total,
  claimedCount,
  openCount,
  canManage,
  controls,
  myRole,
  nowMs,
  invitesLoading,
  linkTeams,
}: {
  leagueId: string
  detail: LeagueDetail
  linkTeams: boolean
  seats: Seat[]
  total: number
  claimedCount: number
  openCount: number
  canManage: boolean
  controls: MemberControls
  myRole: string | null
  nowMs: number
  invitesLoading: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="min-h-0 border-b-0 px-4 pb-1.5 pt-3.5">
        <CardTitle className="text-[15px] font-bold tracking-[-0.02em]">Seats</CardTitle>
        <Badge variant="stroke">
          <span className="fs-num">{claimedCount}</span> / {total} claimed
        </Badge>
      </CardHeader>

      {/* The league link seats nobody once the draft has started (062) —
          said, in the link card's place, for the commissioner. */}
      {canManage && controls.linkClosedNote && (
        <p className="px-4 pb-2 text-[10px] font-medium text-n-6" data-link-closed>
          {controls.linkClosedNote}
        </p>
      )}

      {invitesLoading && (
        <p className="px-4 pb-2 text-[10px] font-medium text-n-6">Loading invites…</p>
      )}

      <div className="border-t border-n-4">
        {seats.map((seat, i) => (
          <SeatRow
            key={seat.key}
            seat={seat}
            leagueId={leagueId}
            linkTeams={linkTeams}
            detail={detail}
            canManage={canManage}
            controls={controls}
            myRole={myRole}
            nowMs={nowMs}
            last={i === seats.length - 1}
          />
        ))}
      </div>

      {canManage && controls.addSeats && openCount > 0 && (
        <div className="border-t border-n-4 px-4 py-3">
          <AddSeatButton leagueId={leagueId} openCount={openCount} />
        </div>
      )}
    </Card>
  )
}

function AddSeatButton({ leagueId, openCount }: { leagueId: string; openCount: number }) {
  // The add / fill loop (its R958 server-postcondition stop) is shared with
  // the phone's Members screen.
  const { add, fillAll, fill, busy } = useFillSeats(leagueId)

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button type="button" variant="stroke" size="sm" disabled={busy} onClick={add}>
        <Icon name="plus" size={13} /> Add an open seat
      </Button>
      {/* `|| fill !== null` keeps the button — and its progress label —
          mounted through the LAST iteration: the mid-loop refetches drive
          `openCount` down to 1 while the fill is still running, so gating on
          the live count alone unmounts the progress at exactly the moment the
          commissioner starts wondering whether it hung (R961). */}
      {(openCount > 1 || fill !== null) && (
        <Button type="button" variant="dark" size="sm" disabled={busy} onClick={() => void fillAll(openCount)}>
          <Icon name="plus" size={13} /> {fillAllLabel(fill, openCount)}
        </Button>
      )}
      <span className="text-[10px] font-medium text-n-6">
        {openCount} seat{openCount === 1 ? '' : 's'} still open.
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One seat row
// ---------------------------------------------------------------------------

function SeatRow({
  seat,
  leagueId,
  detail,
  canManage,
  controls,
  myRole,
  nowMs,
  last,
  linkTeams,
}: {
  seat: Seat
  leagueId: string
  linkTeams: boolean
  detail: LeagueDetail
  canManage: boolean
  controls: MemberControls
  myRole: string | null
  nowMs: number
  last: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 px-4 py-2.5',
        !last && 'border-b border-n-4',
        seat.isSelf && 'bg-accent-soft',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Crest name={seat.status === 'open' ? '· ·' : seat.teamName} />
        <div className="mr-auto min-w-0">
          {/* The seat list is the ONE place every franchise appears with its
              id in hand, so it is a commissioner's index into the team pages
              (§16.1 — `set_lineup` accepts a commissioner acting for an
              unmanaged seat, `114:243`). Two honest limits: an OPEN ghost seat
              carries `teamId: null` (`invite-panel-ops.ts`) and stays plain
              text — no door where there is no team; and `linkTeams` is FALSE
              in the live draft room, where navigating away can cost a pick.
              After the draft this list lives on the members page (L.E1.39). */}
          <div className="truncate text-[12px] font-semibold leading-tight">
            <TeamNameLink
              name={seat.status === 'open' ? 'Open seat' : seat.teamName}
              leagueId={leagueId}
              teamId={linkTeams ? seat.teamId : null}
            />
          </div>
          {/* L.E1.41: a manager's name opens his profile — in a new tab in the
              live draft room (`linkTeams` false), where leaving can cost a pick. */}
          <SeatSubline seat={seat} newTab={!linkTeams} />
        </div>
        <SeatStatusBadge seat={seat} />
        {seat.role && seat.status === 'claimed' && (
          <Badge variant="stroke">{ROLE_LABELS[seat.role] ?? seat.role}</Badge>
        )}
      </div>

      {/* Management affordances (commissioner only), per status. */}
      {seat.status === 'claimed' && canManage && !seat.isSelf && (
        <ClaimedSeatControls seat={seat} leagueId={leagueId} myRole={myRole} detail={detail} controls={controls} />
      )}
      {seat.status === 'invited' && seat.invite && (
        <InvitedSeatControls
          leagueId={leagueId}
          invite={seat.invite}
          canManage={canManage}
          nowMs={nowMs}
        />
      )}
      {seat.status === 'placeholder' && canManage && seat.teamId && (
        <SeatInviteForm leagueId={leagueId} teamId={seat.teamId} />
      )}
      {seat.isSelf && (
        <SelfSeatControls seat={seat} leagueId={leagueId} myRole={myRole} phase={controls.phase} leagueName={detail.league.name} />
      )}
    </div>
  )
}

function SeatSubline({ seat, newTab }: { seat: Seat; newTab: boolean }) {
  if (seat.status === 'claimed') {
    return (
      <div className="truncate text-[10px] font-medium leading-tight text-n-6" data-seat-identity>
        {seat.username ? <UsernameLink username={seat.username} newTab={newTab} /> : seat.identity}
      </div>
    )
  }
  if (seat.status === 'invited') {
    // §7.2/§12.23: the invited email/username is commissioner-visible on a
    // pending invite — this branch never runs for a claimed seat. An invite
    // by username names a real account, so that name opens its profile too.
    return (
      <div className="truncate text-[10px] font-medium leading-tight text-n-6">
        Invited{' '}
        {seat.emailTarget ??
          (seat.usernameTarget ? <UsernameLink username={seat.usernameTarget} newTab={newTab} /> : 'a shared link')}
      </div>
    )
  }
  if (seat.status === 'placeholder') {
    return <div className="text-[10px] font-medium leading-tight text-n-6">No manager yet</div>
  }
  return <div className="text-[10px] font-medium leading-tight text-n-6">Waiting to be filled</div>
}

function SeatStatusBadge({ seat }: { seat: Seat }) {
  const map: Record<Seat['status'], { label: string; variant: 'green' | 'accent' | 'stroke' | 'outline' }> = {
    claimed: { label: 'Claimed', variant: 'green' },
    invited: { label: 'Invited', variant: 'accent' },
    placeholder: { label: 'Open', variant: 'stroke' },
    open: { label: 'Open', variant: 'outline' },
  }
  const { label, variant } = map[seat.status]
  return <Badge variant={variant}>{label}</Badge>
}

// ---------------------------------------------------------------------------
// Claimed seat — role controls + remove
// ---------------------------------------------------------------------------

function ClaimedSeatControls({
  seat,
  leagueId,
  myRole,
  detail,
  controls,
}: {
  seat: Seat
  leagueId: string
  myRole: string | null
  detail: LeagueDetail
  controls: MemberControls
}) {
  // The sitting commissioner can never be removed and needs no role buttons.
  if (seat.role === 'commissioner') {
    return <p className="text-[10px] font-medium text-n-6">The league commissioner runs the show.</p>
  }
  // §7.2 anti-coup (169:442 / :787): a co-commissioner is refused on the
  // league creator's seat — so nothing is offered there; it is said.
  const seatUserId = detail.members.find((m) => m.id === seat.memberId)?.user_id ?? null
  if (creatorSeatBlocked({ myRole, seatUserId, leagueOwnerId: detail.league.owner_id })) {
    return (
      <p className="text-[10px] font-medium text-n-6" data-creator-seat>
        {CREATOR_SEAT_NOTE}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RoleControls seat={seat} leagueId={leagueId} myRole={myRole} />
      <RemoveManagerButton seat={seat} leagueId={leagueId} detail={detail} controls={controls} />
    </div>
  )
}

function RoleControls({ seat, leagueId, myRole }: { seat: Seat; leagueId: string; myRole: string | null }) {
  const roles = useRoleChange(leagueId)
  const isSittingCommish = myRole === 'commissioner'

  async function change(role: MemberRole) {
    await roles.change(seat, role)
  }

  return (
    <>
      {seat.role === 'manager' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={roles.pending}
          onClick={() => change('co_commissioner')}
        >
          <Icon name="arrow-up" size={13} /> Make co-commish
        </Button>
      )}
      {seat.role === 'co_commissioner' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={roles.pending}
          onClick={() => change('manager')}
        >
          <Icon name="arrow-bottom" size={13} /> Make manager
        </Button>
      )}
      {isSittingCommish && (
        <TransferCommishButton seat={seat} leagueId={leagueId} />
      )}
    </>
  )
}

/** The atomic commissioner transfer (§7.2/D74(4)) — you become a
 *  co-commissioner. Only the sitting commissioner may do it; confirm first. */
function TransferCommishButton({ seat, leagueId }: { seat: Seat; leagueId: string }) {
  const [open, setOpen] = useState(false)
  const role = useTransferCommish(leagueId)

  async function confirm() {
    if (await role.transfer(seat)) setOpen(false)
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Icon name="transfer" size={13} /> Make commissioner
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer the commissioner role?</DialogTitle>
            <DialogDescription>
              {seat.teamName} ({seat.identity}) becomes the league commissioner and you step down to
              co-commissioner. There is always exactly one commissioner.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="stroke" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="blue" size="sm" disabled={role.pending} onClick={confirm}>
              {role.pending ? 'Transferring…' : 'Transfer role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** D42 remove chooser — takeover (needs a successor) / vacate (→ placeholder).
 *  The only two outcomes (L.E1.42 — no retire, in any state). */
function RemoveManagerButton({
  seat,
  leagueId,
  detail,
  controls,
}: {
  seat: Seat
  leagueId: string
  detail: LeagueDetail
  controls: MemberControls
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Icon name="remove" size={13} /> Remove
      </Button>
      {open && (
        <RemoveManagerDialog
          seat={seat}
          leagueId={leagueId}
          leagueName={detail.league.name}
          controls={controls}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function RemoveManagerDialog({
  seat,
  leagueId,
  leagueName,
  controls,
  onClose,
}: {
  seat: Seat
  leagueId: string
  leagueName: string
  controls: MemberControls
  onClose: () => void
}) {
  const optionCopy = removeOptionCopy(controls.phase)
  // R1385: §7.2.1(a) — takeover is the default once the draft has started
  // (a mistaken vacate cancels the team's waiver claims); before it, vacate.
  const [mode, setMode] = useState<RemoveMode>(defaultRemoveMode(controls.phase))
  const [successorHandle, setSuccessorHandle] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const remove = useRemoveSeat(leagueId)

  async function confirm() {
    if (!seat.memberId) return
    setError(null)
    const problem = await remove.remove(seat, { mode, successorHandle, reason })
    if (problem) setError(problem)
    else onClose()
  }

  const takeoverReady = mode !== 'takeover' || successorHandle.trim().length > 0

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {seat.teamName}</DialogTitle>
          <DialogDescription>
            {seat.identity} manages {seat.teamName} in {leagueName}. Choose what happens to the
            team.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5">
          <ModeOption
            active={mode === 'vacate'}
            onSelect={() => setMode('vacate')}
            title="Open the seat (vacate)"
            body={optionCopy.vacate}
          />
          <ModeOption
            active={mode === 'takeover'}
            onSelect={() => setMode('takeover')}
            title="Hand it to someone (takeover)"
            body={optionCopy.takeover}
          >
            {mode === 'takeover' && (
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="successor" className="text-[11px] font-semibold">
                  New manager&apos;s username
                </Label>
                <Input
                  id="successor"
                  value={successorHandle}
                  placeholder="@username"
                  onChange={(e) => {
                    setSuccessorHandle(e.target.value)
                    setError(null)
                  }}
                />
              </div>
            )}
          </ModeOption>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="remove-reason" className="text-[11px] font-semibold">
            Reason (optional)
          </Label>
          <Input
            id="remove-reason"
            value={reason}
            placeholder="Noted for the record"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <InlineIssue tone="error" message={error} />}

        <DialogFooter className="gap-2">
          <Button type="button" variant="stroke" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={remove.pending || !takeoverReady}
            onClick={confirm}
          >
            {remove.pending ? 'Removing…' : 'Remove manager'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeOption({
  active,
  disabled,
  onSelect,
  title,
  body,
  children,
}: {
  active: boolean
  disabled?: boolean
  onSelect?: () => void
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent bg-accent-soft' : 'border-n-4',
        disabled ? 'cursor-not-allowed opacity-60' : !active && 'hover:bg-surface-sunken',
      )}
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        {title}
        {disabled && <Badge variant="stroke">Not available</Badge>}
      </div>
      <p className="mt-0.5 text-[10px] font-medium text-n-6">{body}</p>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Invited seat — status + copy link + revoke
// ---------------------------------------------------------------------------

function InvitedSeatControls({
  leagueId,
  invite,
  canManage,
  nowMs,
}: {
  leagueId: string
  invite: PendingInviteInput
  canManage: boolean
  nowMs: number
}) {
  const revoke = useRevokeSeatInvite(leagueId)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const state = inviteState(invite, nowMs)
  const expires = new Date(invite.expires_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  async function doRevoke() {
    await revoke.revoke(invite.id)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-medium text-n-6">
        {state === 'active' ? `Expires ${expires}` : `Invite ${state}`}
      </span>
      {canManage && (
        <>
          <CopyButton
            text={buildJoinLink(origin, invite.token)}
            label="Seat link copied"
            variant="ghost"
            ariaLabel="Copy this seat's invite link"
            withLabel="Copy link"
          />
          <Button type="button" variant="ghost" size="sm" disabled={revoke.pending} onClick={doRevoke}>
            <Icon name="remove" size={13} /> Revoke
          </Button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder seat — email-first invite (+ username / assign / copyable link)
// ---------------------------------------------------------------------------

function SeatInviteForm({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [mode, setMode] = useState<SeatInviteMode>('email')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const invite = useSeatInvite(leagueId, teamId)
  const busy = invite.busy

  async function submit() {
    setError(null)
    const problem = await invite.submit(mode, value)
    if (problem) setError(problem)
    else setValue('')
  }

  async function copySeatLink() {
    setError(null)
    const result = await invite.copySeatLink()
    if (result.status === 'error') setError(result.message)
    // The clipboard refused: the link, to copy by hand (the seat's row now
    // also offers its own Copy link).
    else if (result.status === 'uncopied') toast(copyByHandToast(result.link))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-n-4 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <ModeChip active={mode === 'email'} onClick={() => setMode('email')} icon="email" label="Email" />
        <ModeChip active={mode === 'username'} onClick={() => setMode('username')} icon="profile" label="Username" />
        <ModeChip active={mode === 'assign'} onClick={() => setMode('assign')} icon="team" label="Assign" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          type={mode === 'email' ? 'email' : 'text'}
          placeholder={mode === 'email' ? 'manager@email.com' : '@username'}
          aria-label={
            mode === 'email' ? 'Invite by email' : mode === 'username' ? 'Invite by username' : 'Assign by username'
          }
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="blue" size="sm" disabled={busy} onClick={submit}>
          <Icon name="send" size={13} />
          {mode === 'assign' ? 'Assign' : 'Invite'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={copySeatLink}>
          <Icon name="document" size={13} /> Copy link
        </Button>
      </div>
      {mode === 'email' && (
        <p className="text-[10px] font-medium text-n-6">
          New to FieldScout? Their signup pre-fills this email — no account needed first.
        </p>
      )}
      {error && <InlineIssue tone="error" message={error} />}
    </div>
  )
}

function ModeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: 'email' | 'profile' | 'team'
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-btn-sm items-center gap-1 rounded-pill px-[9px] text-[10px] font-semibold transition-colors',
        active ? 'bg-accent-soft text-accent-deep' : 'bg-surface-control text-n-2 hover:bg-surface-pressed',
      )}
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Self seat — leave the league
// ---------------------------------------------------------------------------

function SelfSeatControls({
  seat,
  leagueId,
  myRole,
  phase,
  leagueName,
}: {
  seat: Seat
  leagueId: string
  myRole: string | null
  phase: MembersPhase
  leagueName: string
}) {
  const [step, setStep] = useState<LeaveStep>('closed')
  const leave = useLeaveSeat(leagueId)
  // Only the SITTING commissioner must transfer first (§7.2.1:192); a
  // co-commissioner leaves freely.
  const mustTransferFirst = myRole === 'commissioner'
  const copy = leaveLeagueCopy(phase, seat.teamName, leagueName)

  async function confirm() {
    // L.E1.41: only the SECOND confirmation leaves (Chris 2026-09-30).
    if (!seat.memberId || !leaveConfirms(step)) return
    if (await leave.leave(seat)) setStep('closed')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">You</Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={mustTransferFirst}
        onClick={() => setStep((s) => nextLeaveStep(s, 'open'))}
        data-leave-league
      >
        <Icon name="transfer" size={13} /> Leave league
      </Button>
      {mustTransferFirst && (
        <span className="text-[10px] font-medium text-n-6">{LEAVE_BLOCKED_NOTE}</span>
      )}
      <Dialog open={step !== 'closed'} onOpenChange={(open) => !open && setStep('closed')}>
        <DialogContent>
          <LeaveLeagueSteps
            step={step}
            copy={copy}
            pending={leave.pending}
            onStep={(event) => setStep((s) => nextLeaveStep(s, event))}
            onConfirm={confirm}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The two confirmations of leaving a league (L.E1.41) — the dialog's body,
 * exported so the render proof can mount each step. Step one says what
 * happens to the team; step two is the last check, and only its button
 * leaves.
 */
export function LeaveLeagueSteps({
  step,
  copy,
  pending,
  onStep,
  onConfirm,
}: {
  step: LeaveStep
  copy: LeaveCopy
  pending: boolean
  onStep: (event: 'continue' | 'back' | 'cancel') => void
  onConfirm: () => void
}) {
  if (step === 'final') {
    return (
      <div className="flex flex-col gap-4" data-leave-step="final">
        <DialogHeader>
          <DialogTitle>{copy.finalTitle}</DialogTitle>
          <DialogDescription>{copy.finalBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="stroke" size="sm" onClick={() => onStep('back')}>
            Back
          </Button>
          <Button type="button" variant="stroke" size="sm" onClick={() => onStep('cancel')}>
            {copy.stayLabel}
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={onConfirm} data-leave-confirm>
            {pending ? 'Leaving…' : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4" data-leave-step="consequences">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.consequences}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button type="button" variant="stroke" size="sm" onClick={() => onStep('cancel')}>
          {copy.stayLabel}
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => onStep('continue')} data-leave-continue>
          {copy.continueLabel}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ===========================================================================
// Shared helpers
// ===========================================================================

/** A copy-to-clipboard button (icon-only by default, or with a label). */
function CopyButton({
  text,
  label,
  disabled,
  ariaLabel,
  variant = 'stroke',
  withLabel,
}: {
  text: string | null
  label: string
  disabled?: boolean
  ariaLabel: string
  variant?: 'stroke' | 'ghost'
  withLabel?: string
}) {
  async function copy() {
    if (!text) return
    await copyWithToast(text, label)
  }
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={copy}
    >
      <Icon name="document" size={13} />
      {withLabel ?? 'Copy'}
    </Button>
  )
}
