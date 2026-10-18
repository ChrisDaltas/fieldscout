'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { mockIdentityLabel, mockProgressLabel } from '@/components/draft/mock-launcher-ops'
import { AttachListInline } from '@/components/leagues/attach-list-modal'
import { buildJoinLink, deriveSeats, memberControls, membersPageHref, preferredShareCode, type Seat } from '@/components/leagues/invite-panel-ops'
import { teamPageHref } from '@/components/leagues/league-cells'
import { SettingsSkin } from '@/components/leagues/settings-form-controls'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueInvites } from '@/hooks/use-league-invites'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { useDeleteMockDraft, type MockDraftSummary } from '@/hooks/use-mock-drafts'
import { useTeamOnline } from '@/hooks/use-online'
import type { RoomEntryTargetProps } from '@/hooks/use-room-entry-target-ops'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'

import { TeamAvatar } from './league-bits'
import { teamAvatarClass } from './league-tab-ops'

/**
 * The pre-draft League tab's league pieces in the mobile language (handoff
 * m-league — the design has no pre-draft screen; the app's own pieces are
 * kept and restyled, CLAUDE.md "Prototype gaps"). Each reads and writes
 * through the same hooks and ops as the desktop component it replaces:
 *  - `ManagersCard` — the seat list (`deriveSeats`: claimed seats show the
 *    team and its manager, an invited seat the invite, never a claimed
 *    seat's email), the commissioner's share link with Copy, and the door
 *    to Members for invites, seats, roles, removal and leaving.
 *  - `DraftListButton` — "Add a draft list": a sheet over your own lists
 *    (the one-tap suggestion, the picker, primary-board / share toggles).
 *  - `PracticeRow` — one practice draft: status, what it was, progress,
 *    Resume / Rejoin / View report, Delete.
 */

const PILL = 'flex h-9 flex-none items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold'
const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'

function messageOf(cause: unknown): string {
  if (cause instanceof LeagueActionError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

const SEAT_PILL: Record<Seat['status'], { label: string; cls: string }> = {
  claimed: { label: 'Claimed', cls: 'bg-m-gg text-m-tg' },
  invited: { label: 'Invited', cls: 'bg-m-gb text-m-tb' },
  placeholder: { label: 'Open', cls: 'bg-m-b2 text-m-t3' },
  open: { label: 'Open', cls: 'bg-m-b2 text-m-t3' },
}

export function ManagersCard({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const canManage = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  // Only a commissioner may read the invite rows (RLS §12.23).
  const invites = useLeagueInvites(leagueId, canManage)
  const [nowMs] = useState(() => Date.now())
  const model = deriveSeats(
    {
      teamCount: detail.settings.team_count,
      members: detail.members,
      teams: detail.teams,
      invites: invites.data ?? [],
      currentUserId: user?.id ?? null,
    },
    nowMs,
  )
  const controls = memberControls(
    detail.league.status,
    model.seats.some((s) => s.status === 'placeholder' || s.status === 'invited'),
  )
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const teamIds = detail.teams.map((t) => t.id)
  // Who's online (gap list §3 #25): a claimed seat lights up with its manager.
  const teamOnline = useTeamOnline(detail.members)

  return (
    <section id="invites" className="flex flex-col gap-2" aria-label="Managers" data-managers-card>
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Managers</h2>
        <span className="text-[12px] font-medium tabular-nums text-m-t3">
          {model.claimedCount} / {model.total} claimed
        </span>
      </div>

      {canManage && controls.shareLink && <ShareLink inviteCode={detail.league.invite_code} inviteSlug={detail.league.invite_slug} />}
      {canManage && controls.linkClosedNote && <p className={cn(NOTE, 'px-1')}>{controls.linkClosedNote}</p>}

      <ul className="flex flex-col rounded-[16px] bg-m-b1 px-3.5" aria-label="Seats">
        {model.seats.map((seat) => (
          <li key={seat.key} className="flex min-h-[56px] items-center gap-3 border-b border-m-b3 py-2 last:border-b-0" data-seat={seat.status}>
            {seat.status === 'open' || !seat.teamId ? (
              <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-m-t5 text-[11px] font-semibold text-white">
                •
              </span>
            ) : (
              <TeamAvatar
                name={seat.teamName}
                size={32}
                className={teamAvatarClass(seat.teamId, teamIds, myTeamId)}
                online={teamOnline(seat.teamId)}
                onlineRingClass="ring-m-b1"
              />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              {seat.teamId && seat.status !== 'open' ? (
                <Link href={teamPageHref(leagueId, seat.teamId)} className="truncate text-[14px] font-semibold text-m-t1">
                  {seat.teamName}
                </Link>
              ) : (
                <span className="truncate text-[14px] font-semibold text-m-t1">Open seat</span>
              )}
              <span className="truncate text-[12px] font-medium text-m-t3">
                <SeatLine seat={seat} />
              </span>
            </span>
            <span className={cn('flex h-[20px] flex-none items-center rounded-pill px-2 text-[11px] font-semibold', SEAT_PILL[seat.status].cls)}>
              {SEAT_PILL[seat.status].label}
            </span>
          </li>
        ))}
        {canManage && invites.isPending && <li className={cn(NOTE, 'py-2')}>Loading invites…</li>}
      </ul>

      {canManage && controls.addSeats && model.openCount > 0 && (
        <p className={cn(NOTE, 'px-1')}>
          {model.openCount} seat{model.openCount === 1 ? '' : 's'} still open — add them or fill them all in Members.
        </p>
      )}

      <Link href={membersPageHref(leagueId)} className="flex h-12 items-center gap-3 rounded-[14px] bg-m-b1 px-3 active:bg-m-b2h" data-door="members">
        <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b2 text-m-t1">
          <MIcon name="coowners" size={16} />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-m-t1">{canManage ? 'Manage members' : 'Members'}</span>
        <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
      </Link>
    </section>
  )
}

function SeatLine({ seat }: { seat: Seat }) {
  const role = seat.role === 'commissioner' ? 'Commissioner' : seat.role === 'co_commissioner' ? 'Co-commissioner' : null
  if (seat.status === 'claimed') {
    return (
      <>
        {seat.username ? <UsernameLink username={seat.username} /> : seat.identity}
        {seat.isSelf && ' · you'}
        {role && ` · ${role}`}
      </>
    )
  }
  if (seat.status === 'invited') {
    return (
      <>
        Invited{' '}
        {seat.emailTarget ?? (seat.usernameTarget ? <UsernameLink username={seat.usernameTarget} /> : 'by a shared link')}
      </>
    )
  }
  if (seat.status === 'placeholder') return <>No manager yet</>
  return <>Waiting to be filled</>
}

function ShareLink({ inviteCode, inviteSlug }: { inviteCode: string | null; inviteSlug: string | null }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const code = preferredShareCode(inviteSlug, inviteCode)
  const link = code ? buildJoinLink(origin, code) : null
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast({ title: 'Invite link copied' })
    } catch {
      toast({ title: 'Copy it manually', description: link })
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-[16px] bg-m-b1 p-3.5" data-share-link>
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[14px] font-semibold text-m-t1">Invite link</span>
          <span className="truncate text-[12px] font-medium text-m-t3">{link ?? 'No link yet'}</span>
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!link}
          aria-label="Copy the league share link"
          className={cn(PILL, 'h-8 bg-m-b0 px-3.5 text-m-t1 active:bg-m-b2 disabled:opacity-50')}
        >
          Copy
        </button>
      </div>
      <p className={NOTE}>Anyone with this link can claim an open seat — paste it into any chat or email.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add a draft list
// ---------------------------------------------------------------------------

export function DraftListButton({
  leagueId,
  leagueName,
  scoringSystemId,
  className,
}: {
  leagueId: string
  leagueName: string
  scoringSystemId: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(PILL, 'bg-m-b0 text-m-t1 active:bg-m-b2', className)}>
        <MIcon name="lists" size={14} />
        Add a draft list
      </button>
      {open && (
        <DraftListSheet leagueId={leagueId} leagueName={leagueName} scoringSystemId={scoringSystemId} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/** Mounted only while open, so your lists are read only then. The body is
 *  the ONE phone attach body (`AttachListInline` in the phone skin — the
 *  create-league sheet's success step draws the same), with its Attach
 *  button pinned in this sheet's footer. */
function DraftListSheet({
  leagueId,
  leagueName,
  scoringSystemId,
  onClose,
}: {
  leagueId: string
  leagueName: string
  scoringSystemId: string | null
  onClose: () => void
}) {
  const { user } = useAuth()
  const rows = useLeagueLists(leagueId)
  // Your attached lists here (the read is yours + shared: keep yours).
  const attachedIds = useMemo(
    () => new Set((rows.data ?? []).filter((r) => r.owner_id === user?.id).map((r) => r.list_id)),
    [rows.data, user?.id],
  )

  return (
    <SettingsSkin layout="mobile">
      <AttachListInline
        leagueId={leagueId}
        leagueName={leagueName}
        scoringSystemId={scoringSystemId}
        attachedListIds={attachedIds}
        onAttached={onClose}
        frame={({ body, attach }) => (
          <MobileSheet
            open
            onOpenChange={(next) => !next && onClose()}
            title="Add a draft list"
            subtitle={`Attach one of your ranking lists to ${leagueName} — it’s one tap away in the draft room and all season.`}
            footer={attach}
          >
            <div className="px-5 pb-2">{body}</div>
          </MobileSheet>
        )}
      />
    </SettingsSkin>
  )
}

// ---------------------------------------------------------------------------
// One practice draft
// ---------------------------------------------------------------------------

export function PracticeRow({
  leagueId,
  row,
  seatCount,
  openBlocked,
  roomEntry,
}: {
  leagueId: string
  row: MockDraftSummary
  seatCount: number | null
  /** Why it can't be opened yet, or null. */
  openBlocked: string | null
  roomEntry: RoomEntryTargetProps
}) {
  const deleteMock = useDeleteMockDraft(leagueId)
  const complete = row.status === 'complete'
  const openLabel = complete ? 'View report' : row.status === 'paused' ? 'Resume' : 'Rejoin'
  const status = complete
    ? { label: 'Report', cls: 'bg-m-b2 text-m-t3' }
    : row.status === 'paused'
      ? { label: 'Paused', cls: 'bg-m-go text-m-to' }
      : { label: 'Live', cls: 'bg-m-gg text-m-tg' }
  const progress = complete
    ? row.completed_at
      ? `Finished ${new Date(row.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : 'Finished'
    : mockProgressLabel(row, seatCount)
  const remove = () => {
    deleteMock.mutateAsync(row.id).catch((error: unknown) => {
      toast({
        title: complete ? 'Couldn’t delete the report' : 'Couldn’t delete the practice draft',
        description: messageOf(error),
        variant: 'destructive',
      })
    })
  }
  return (
    <div className="flex flex-col gap-2.5 border-b border-m-b3 py-3 last:border-b-0" data-practice-row={row.id}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex h-[20px] flex-none items-center rounded-pill px-2 text-[11px] font-semibold', status.cls)}>{status.label}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{mockIdentityLabel(row, seatCount)}</span>
      </div>
      <p className={NOTE}>{progress}</p>
      {openBlocked && (
        <p className={NOTE} role="status">
          {openBlocked}
        </p>
      )}
      <div className="flex items-center gap-2">
        {openBlocked ? (
          <span className={cn(PILL, 'h-8 bg-m-b0 px-3.5 text-m-t4')} aria-disabled="true">
            {openLabel}
          </span>
        ) : complete ? (
          <Link href={`/app/mocks/${row.id}/report`} className={cn(PILL, 'h-8 bg-m-b0 px-3.5 text-m-t1 active:bg-m-b2')}>
            {openLabel}
          </Link>
        ) : (
          <Link href={`/app/leagues/${leagueId}/draft?draft=${row.id}`} {...roomEntry} className={cn(PILL, 'h-8 bg-accent px-3.5 text-white active:bg-accent-strong')}>
            {openLabel}
          </Link>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={deleteMock.isPending}
          aria-label={complete ? 'Delete report' : 'Delete practice draft'}
          className={cn(PILL, 'h-8 bg-m-gr px-3.5 text-m-tr disabled:opacity-50')}
        >
          {deleteMock.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
