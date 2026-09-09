'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import {
  useCreateInvite,
  useLeagueInvites,
  useRevokeInvite,
  useRotateInviteCode,
  useSetInviteSlug,
} from '@/hooks/use-league-invites'
import {
  useAddPlaceholderSeat,
  useAssignManager,
  useLeaveLeague,
  useRemoveManager,
  useSetMemberRole,
  type MemberRole,
  type RemoveMode,
} from '@/hooks/use-league-members'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { InlineIssue } from './settings-form-controls'
import { Crest } from './league-cells'
import {
  buildJoinLink,
  deriveSeats,
  inviteState,
  preferredShareCode,
  validateSlug,
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
 * vacate; retire disabled with the "after the draft" note).
 *
 * THE PRIVACY INVARIANT (§7.2/§12.23): the seat identity comes from
 * `deriveSeats` — a claimed seat renders *Team — @username* and
 * NEVER an email; `invited_email` shows only on a pending invited seat, where
 * the commissioner is meant to see it. The commissioner reads the invite rows
 * (email included) over the §12.23 RLS policy, but the render authority is the
 * ops layer, pinned in `invite-panel-ops.test.ts`.
 */
export function InvitePanel({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
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

  return (
    <div className="flex flex-col gap-[19px]">
      {canManage && (
        <ShareLinkCard
          leagueId={leagueId}
          inviteCode={detail.league.invite_code}
          inviteSlug={detail.league.invite_slug}
        />
      )}

      <SeatsCard
        leagueId={leagueId}
        detail={detail}
        seats={model.seats}
        total={model.total}
        claimedCount={model.claimedCount}
        openCount={model.openCount}
        canManage={canManage}
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
      <CardHeader>
        <CardTitle>Invite link</CardTitle>
        <RotateLinkButton leagueId={leagueId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="share-link" className="text-[13px] font-bold">
            League share link
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="share-link"
              readOnly
              value={shareLink ?? 'No link yet'}
              onFocus={(e) => e.currentTarget.select()}
              className="text-[12px]"
            />
            <CopyButton
              text={shareLink}
              label="Invite link copied"
              disabled={!shareLink}
              ariaLabel="Copy the league share link"
            />
          </div>
          <p className="text-[11px] font-semibold text-n-3">
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
  const setSlug = useSetInviteSlug(leagueId)

  const trimmed = value.trim()
  const dirty = trimmed !== (inviteSlug ?? '')

  async function save() {
    const clientError = validateSlug(trimmed)
    if (clientError) {
      setError(clientError)
      return
    }
    setError(null)
    try {
      await setSlug.mutateAsync(trimmed.toLowerCase())
      toast({ title: 'Custom link saved', description: `/join/${trimmed.toLowerCase()}` })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function clear() {
    setError(null)
    try {
      await setSlug.mutateAsync(null)
      setValue('')
      toast({ title: 'Custom link cleared', description: 'The random share code is active again.' })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  return (
    <div className="space-y-1.5 border-t border-n-4 pt-3">
      <Label htmlFor="slug-input" className="text-[13px] font-bold">
        Custom link
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-n-3">/join/</span>
        <Input
          id="slug-input"
          value={value}
          placeholder="your-league"
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          className="h-btn-md w-44 text-[12px]"
        />
        <Button
          type="button"
          variant="stroke"
          size="sm"
          disabled={!dirty || setSlug.isPending}
          onClick={save}
        >
          <Icon name="save" size={13} /> Save
        </Button>
        {inviteSlug && (
          <Button type="button" variant="ghost" size="sm" disabled={setSlug.isPending} onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {error && <InlineIssue tone="error" message={error} />}
      <p className="text-[11px] font-semibold text-n-3">
        Letters, numbers and hyphens. Survives a link rotation.
      </p>
    </div>
  )
}

/** Rotate = destructive: invalidates the current share code (old links stop
 *  working). Confirm dialog per §22.5; the custom slug survives. */
function RotateLinkButton({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  const rotate = useRotateInviteCode(leagueId)

  async function confirm() {
    try {
      await rotate.mutateAsync()
      setOpen(false)
      toast({
        title: 'Invite link rotated',
        description: 'The old share code no longer works. Your custom link still does.',
      })
    } catch (cause) {
      toast({ title: "Couldn't rotate the link", description: messageOf(cause) })
    }
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
              disabled={rotate.isPending}
              onClick={confirm}
            >
              {rotate.isPending ? 'Rotating…' : 'Rotate link'}
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
  myRole,
  nowMs,
  invitesLoading,
}: {
  leagueId: string
  detail: LeagueDetail
  seats: Seat[]
  total: number
  claimedCount: number
  openCount: number
  canManage: boolean
  myRole: string | null
  nowMs: number
  invitesLoading: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Seats</CardTitle>
        <Badge variant="stroke">
          <span className="fs-num">{claimedCount}</span> / {total} claimed
        </Badge>
      </CardHeader>

      {invitesLoading && (
        <p className="px-card-pad pb-2 text-[11px] font-semibold text-n-3">Loading invites…</p>
      )}

      <div>
        {seats.map((seat, i) => (
          <SeatRow
            key={seat.key}
            seat={seat}
            leagueId={leagueId}
            detail={detail}
            canManage={canManage}
            myRole={myRole}
            nowMs={nowMs}
            last={i === seats.length - 1}
          />
        ))}
      </div>

      {canManage && openCount > 0 && (
        <div className="border-t border-n-4 px-card-pad py-3">
          <AddSeatButton leagueId={leagueId} openCount={openCount} />
        </div>
      )}
    </Card>
  )
}

function AddSeatButton({ leagueId, openCount }: { leagueId: string; openCount: number }) {
  const addSeat = useAddPlaceholderSeat(leagueId)
  const [fill, setFill] = useState<{ done: number; target: number } | null>(null)
  const busy = addSeat.isPending || fill !== null

  async function add() {
    try {
      await addSeat.mutateAsync(undefined)
      toast({ title: 'Open seat added', description: 'Invite a manager to it, or share the link.' })
    } catch (cause) {
      toast({ title: "Couldn't add a seat", description: messageOf(cause) })
    }
  }

  // Fill every remaining slot in one press. §7.2/D96 requires every seat to
  // EXIST before the draft can start, so a solo commissioner opening a 12-team
  // league otherwise has to press "Add an open seat" eleven times before
  // start_draft will accept — the failure Chris hit on 2026-09-09.
  //
  // Sequential, never parallel: add_placeholder_seat re-reads capacity under a
  // lock (063/R93) and raises once the league is full, so overlapping requests
  // would race on the final seat and surface a spurious error. One at a time
  // means a mid-flight failure stops cleanly with an accurate count, and the
  // seats already created stay created (each call is its own transaction).
  async function fillAll() {
    const target = openCount
    setFill({ done: 0, target })
    let done = 0
    try {
      for (let i = 0; i < target; i += 1) {
        await addSeat.mutateAsync(undefined)
        done += 1
        setFill({ done, target })
      }
      toast({
        title: `${done} seat${done === 1 ? '' : 's'} added`,
        description: 'Every franchise exists now. Invite managers to them, or draft as they are.',
      })
    } catch (cause) {
      // Never report a partial fill as success — say how far it got (the seats
      // created before the failure are real and persist).
      toast({
        title: done > 0 ? `Stopped after ${done} of ${target}` : "Couldn't add the seats",
        description: messageOf(cause),
      })
    } finally {
      setFill(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button type="button" variant="stroke" size="sm" disabled={busy} onClick={add}>
        <Icon name="plus" size={13} /> Add an open seat
      </Button>
      {openCount > 1 && (
        <Button type="button" variant="dark" size="sm" disabled={busy} onClick={fillAll}>
          <Icon name="plus" size={13} />{' '}
          {fill
            ? `Adding ${Math.min(fill.done + 1, fill.target)} of ${fill.target}\u2026`
            : `Fill all ${openCount} seats`}
        </Button>
      )}
      <span className="text-[11px] font-semibold text-n-3">
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
  myRole,
  nowMs,
  last,
}: {
  seat: Seat
  leagueId: string
  detail: LeagueDetail
  canManage: boolean
  myRole: string | null
  nowMs: number
  last: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 px-card-pad py-3',
        !last && 'border-b border-n-4',
        seat.isSelf && 'bg-accent-soft',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Crest name={seat.status === 'open' ? '· ·' : seat.teamName} />
        <div className="mr-auto min-w-0">
          <div className="truncate text-[12px] font-extrabold leading-tight">
            {seat.status === 'open' ? 'Open seat' : seat.teamName}
          </div>
          <SeatSubline seat={seat} />
        </div>
        <SeatStatusBadge seat={seat} />
        {seat.role && seat.status === 'claimed' && (
          <Badge variant="stroke">{ROLE_LABELS[seat.role] ?? seat.role}</Badge>
        )}
      </div>

      {/* Management affordances (commissioner only), per status. */}
      {seat.status === 'claimed' && canManage && !seat.isSelf && (
        <ClaimedSeatControls seat={seat} leagueId={leagueId} myRole={myRole} detail={detail} />
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
      {seat.isSelf && <SelfSeatControls seat={seat} leagueId={leagueId} myRole={myRole} />}
    </div>
  )
}

function SeatSubline({ seat }: { seat: Seat }) {
  if (seat.status === 'claimed') {
    return (
      <div className="truncate text-[11px] font-semibold leading-tight text-n-3">{seat.identity}</div>
    )
  }
  if (seat.status === 'invited') {
    // §7.2/§12.23: the invited email/username is commissioner-visible on a
    // pending invite — this branch never runs for a claimed seat.
    const target = seat.emailTarget ?? (seat.usernameTarget ? `@${seat.usernameTarget}` : 'a shared link')
    return (
      <div className="truncate text-[11px] font-semibold leading-tight text-n-3">Invited {target}</div>
    )
  }
  if (seat.status === 'placeholder') {
    return <div className="text-[11px] font-semibold leading-tight text-n-3">No manager yet</div>
  }
  return <div className="text-[11px] font-semibold leading-tight text-n-3">Waiting to be filled</div>
}

const ROLE_LABELS: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
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
}: {
  seat: Seat
  leagueId: string
  myRole: string | null
  detail: LeagueDetail
}) {
  // The sitting commissioner can never be removed and needs no role buttons.
  if (seat.role === 'commissioner') {
    return <p className="text-[11px] font-semibold text-n-3">The league commissioner runs the show.</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RoleControls seat={seat} leagueId={leagueId} myRole={myRole} />
      <RemoveManagerButton seat={seat} leagueId={leagueId} detail={detail} />
    </div>
  )
}

function RoleControls({ seat, leagueId, myRole }: { seat: Seat; leagueId: string; myRole: string | null }) {
  const setRole = useSetMemberRole(leagueId)
  const isSittingCommish = myRole === 'commissioner'

  async function change(role: MemberRole) {
    if (!seat.memberId) return
    try {
      await setRole.mutateAsync({ memberId: seat.memberId, role })
      toast({ title: 'Role updated', description: `${seat.teamName} is now ${ROLE_LABELS[role]}.` })
    } catch (cause) {
      toast({ title: "Couldn't change the role", description: messageOf(cause) })
    }
  }

  return (
    <>
      {seat.role === 'manager' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={setRole.isPending}
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
          disabled={setRole.isPending}
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
  const setRole = useSetMemberRole(leagueId)

  async function confirm() {
    if (!seat.memberId) return
    try {
      await setRole.mutateAsync({ memberId: seat.memberId, role: 'commissioner' })
      setOpen(false)
      toast({
        title: 'Commissioner role transferred',
        description: `${seat.teamName} is now the commissioner. You're a co-commissioner.`,
      })
    } catch (cause) {
      toast({ title: "Couldn't transfer the role", description: messageOf(cause) })
    }
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
            <Button type="button" variant="blue" size="sm" disabled={setRole.isPending} onClick={confirm}>
              {setRole.isPending ? 'Transferring…' : 'Transfer role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** D42 remove chooser — takeover (needs a successor) / vacate (→ placeholder);
 *  retire is disabled with the "after the draft" note (M1 pre-draft). */
function RemoveManagerButton({
  seat,
  leagueId,
  detail,
}: {
  seat: Seat
  leagueId: string
  detail: LeagueDetail
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
  onClose,
}: {
  seat: Seat
  leagueId: string
  leagueName: string
  onClose: () => void
}) {
  const [mode, setMode] = useState<RemoveMode>('vacate')
  const [successorHandle, setSuccessorHandle] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const remove = useRemoveManager(leagueId)

  async function confirm() {
    if (!seat.memberId) return
    setError(null)
    try {
      let successorUserId: string | undefined
      if (mode === 'takeover') {
        successorUserId = await resolveUsername(successorHandle)
      }
      await remove.mutateAsync({
        memberId: seat.memberId,
        mode,
        successorUserId,
        reason: reason.trim() || undefined,
      })
      onClose()
      toast({
        title: mode === 'takeover' ? 'Franchise handed over' : 'Seat opened',
        description:
          mode === 'takeover'
            ? `${seat.teamName} has a new manager.`
            : `${seat.teamName} is now an open seat — invite a replacement.`,
      })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const takeoverReady = mode !== 'takeover' || successorHandle.trim().length > 0

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {seat.teamName}</DialogTitle>
          <DialogDescription>
            {seat.identity} manages {seat.teamName} in {leagueName}. Choose what happens to the
            franchise.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5">
          <ModeOption
            active={mode === 'vacate'}
            onSelect={() => setMode('vacate')}
            title="Open the seat (vacate)"
            body="The franchise stays put and becomes an open seat. Invite a replacement to it afterward — the recommended path before the draft."
          />
          <ModeOption
            active={mode === 'takeover'}
            onSelect={() => setMode('takeover')}
            title="Hand it to someone (takeover)"
            body="A specific person takes over this franchise right now. They must have a FieldScout account and not already be in this league."
          >
            {mode === 'takeover' && (
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="successor" className="text-[12px] font-bold">
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
                  className="h-btn-md text-[12px]"
                />
              </div>
            )}
          </ModeOption>
          <ModeOption
            active={false}
            disabled
            title="Retire the franchise"
            body="Seals the franchise and starts a successor — not available before the draft. It arrives with the in-season tools."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="remove-reason" className="text-[12px] font-bold">
            Reason (optional)
          </Label>
          <Input
            id="remove-reason"
            value={reason}
            placeholder="Noted for the record"
            onChange={(e) => setReason(e.target.value)}
            className="h-btn-md text-[12px]"
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
            disabled={remove.isPending || !takeoverReady}
            onClick={confirm}
          >
            {remove.isPending ? 'Removing…' : 'Remove manager'}
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
        'rounded-sm border px-3 py-2.5 text-left transition-colors',
        active ? 'border-ink bg-accent-soft' : 'border-n-4',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-ink',
      )}
    >
      <div className="flex items-center gap-2 text-[13px] font-bold">
        {title}
        {disabled && <Badge variant="stroke">After the draft</Badge>}
      </div>
      <p className="mt-0.5 text-[11px] font-semibold text-n-3">{body}</p>
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
  const revoke = useRevokeInvite(leagueId)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const state = inviteState(invite, nowMs)
  const expires = new Date(invite.expires_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  async function doRevoke() {
    try {
      await revoke.mutateAsync(invite.id)
      toast({ title: 'Invite revoked', description: 'That link no longer works.' })
    } catch (cause) {
      toast({ title: "Couldn't revoke the invite", description: messageOf(cause) })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold text-n-3">
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
          <Button type="button" variant="ghost" size="sm" disabled={revoke.isPending} onClick={doRevoke}>
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

type InviteMode = 'email' | 'username' | 'assign'

function SeatInviteForm({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [mode, setMode] = useState<InviteMode>('email')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createInvite = useCreateInvite(leagueId)
  const assignManager = useAssignManager(leagueId)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const busy = createInvite.isPending || assignManager.isPending

  async function submit() {
    setError(null)
    const entry = value.trim()
    if (!entry) {
      setError(mode === 'email' ? 'Enter an email address.' : 'Enter a username.')
      return
    }
    try {
      if (mode === 'email') {
        const result = await createInvite.mutateAsync({ target_team_id: teamId, invited_email: entry })
        setValue('')
        toast({
          title: result.email_sent ? 'Invite emailed' : 'Invite created',
          description: result.email_sent
            ? `We sent ${entry} a claim link.`
            : `Share the seat link with ${entry}.`,
        })
      } else if (mode === 'username') {
        await createInvite.mutateAsync({
          target_team_id: teamId,
          invited_username: entry.replace(/^@/, ''),
        })
        setValue('')
        toast({ title: 'Invite sent', description: `@${entry.replace(/^@/, '')} was notified.` })
      } else {
        const userId = await resolveUsername(entry)
        await assignManager.mutateAsync({ teamId, userId })
        setValue('')
        toast({ title: 'Manager seated', description: `@${entry.replace(/^@/, '')} now runs this seat.` })
      }
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function copySeatLink() {
    setError(null)
    try {
      const result = await createInvite.mutateAsync({ target_team_id: teamId })
      const link = buildJoinLink(origin, result.token)
      await copyToClipboard(link)
      toast({ title: 'Seat link copied', description: 'Anyone with it claims this exact seat.' })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-n-4 p-2.5">
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
          className="h-btn-md min-w-0 flex-1 text-[12px]"
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
        <p className="text-[11px] font-semibold text-n-3">
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
        'inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-bold transition-colors',
        active ? 'border-ink bg-ink text-page' : 'border-n-4 text-n-3 hover:border-ink',
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
}: {
  seat: Seat
  leagueId: string
  myRole: string | null
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const leave = useLeaveLeague(leagueId)
  // Only the SITTING commissioner must transfer first (§7.2.1:192); a
  // co-commissioner leaves freely.
  const mustTransferFirst = myRole === 'commissioner'

  async function confirm() {
    if (!seat.memberId) return
    try {
      await leave.mutateAsync(seat.memberId)
      setOpen(false)
      toast({ title: 'You left the league', description: `${seat.teamName} is now an open seat.` })
      router.push('/app/leagues')
    } catch (cause) {
      toast({ title: "Couldn't leave the league", description: messageOf(cause) })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">You</Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={mustTransferFirst}
        onClick={() => setOpen(true)}
      >
        <Icon name="transfer" size={13} /> Leave league
      </Button>
      {mustTransferFirst && (
        <span className="text-[11px] font-semibold text-n-3">
          Transfer the commissioner role to another member before you can leave.
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this league?</DialogTitle>
            <DialogDescription>
              Your franchise ({seat.teamName}) becomes an open seat. You can be re-invited later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="stroke" size="sm" onClick={() => setOpen(false)}>
              Stay
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={leave.isPending} onClick={confirm}>
              {leave.isPending ? 'Leaving…' : 'Leave league'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    const ok = await copyToClipboard(text)
    toast(ok ? { title: label } : { title: 'Copy it manually', description: text })
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Resolve a public @username to its profile id (§7.2 usernames are public;
 *  profiles are world-readable). Throws a friendly LeagueActionError. */
async function resolveUsername(raw: string): Promise<string> {
  const handle = raw.trim().replace(/^@/, '').toLowerCase()
  if (!handle) throw new LeagueActionError(400, 'Enter a username.')
  const supabase = createBrowserClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', handle)
    .maybeSingle()
  if (error) throw new LeagueActionError(500, 'Could not look up that username.')
  if (!data) throw new LeagueActionError(404, `No FieldScout account @${handle}.`)
  return data.id
}

function messageOf(cause: unknown): string {
  if (cause instanceof LeagueActionError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'Something went wrong. Please try again.'
}
