'use client'

import { useState } from 'react'

import { fillAllLabel, useFillSeats } from '@/components/leagues/invite-panel-actions'
import {
  LEAVE_BLOCKED_NOTE,
  MEMBERS_INTRO_COMMISH,
  MEMBERS_INTRO_MEMBER,
  MEMBERS_TITLE,
  deriveSeats,
  memberControls,
  nextLeaveStep,
  type LeaveStep,
  type Seat,
} from '@/components/leagues/invite-panel-ops'
import { CenteredNote, LeaguePageBar, SkeletonBlocks } from '@/components/mobile/league/league/league-bits'
import { teamAvatarClass } from '@/components/mobile/league/league/league-tab-ops'
import { MNotice } from '@/components/mobile/ui/m-form'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeagueInvites } from '@/hooks/use-league-invites'
import { useTeamOnline } from '@/hooks/use-online'
import { cn } from '@/lib/utils'

import { LeaveSheet, RotateSheet, SeatSheet, SlugSheet } from './member-sheets'
import { seatAction, seatActionLabel } from './members-ops'
import { SeatRow, ShareLinkCard } from './seat-parts'

const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'
const PILL = 'flex h-9 flex-none items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold disabled:opacity-60'

/**
 * League Menu › Members on the phone (gap list §4 item 106) — the phone's
 * screen for `/members`, on the same reads, verbs and rules as desktop's
 * `MembersPage` / `InvitePanel`, which is unchanged. The handoff draws no
 * Members page, so it extends the G pages (League settings, Draft results):
 * the 52px bar, 13/600 t3 section titles, and the League tab's Managers
 * card rows (`SeatRow` — one row for both).
 *
 * Every seat shows its team (a door to its page) and its manager's @handle
 * (a door to his profile). A commissioner or co-commissioner gets, per
 * seat, a "more" control opening that seat's sheet — roles, the
 * commissioner transfer and remove for a seated manager; invite / assign /
 * a seat link for a team with no manager; copy / revoke for an invite
 * that's out — offered only where its verb accepts the league's state
 * (`memberControls`, `seatAction`). Before the draft the share link (copy,
 * custom link, rotate) and Add / Fill seats sit with them. Your own seat's
 * Leave is at the foot, with its two confirmations; the sitting
 * commissioner sees it greyed with why (prevent, don't refuse).
 * Back goes to where you came from, else the League tab.
 */
export function MobileMembers({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  const header = <LeaguePageBar leagueId={leagueId} title={MEMBERS_TITLE} />
  if (league.isPending) {
    return (
      <MobileScreen header={header}>
        <div className="px-4 pt-3" data-members-loading>
          <SkeletonBlocks count={4} className="h-14" />
        </div>
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen header={header}>
        <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void league.refetch()} />
      </MobileScreen>
    )
  }
  return <MembersScreen leagueId={leagueId} detail={league.data} header={header} />
}

function MembersScreen({ leagueId, detail, header }: { leagueId: string; detail: LeagueDetail; header: React.ReactNode }) {
  const { user } = useAuth()
  const canManage = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  // Only a commissioner may read the invite rows (RLS §12.23).
  const invites = useLeagueInvites(leagueId, canManage)
  // Until they've loaded, a team with an invite out reads as one with no
  // manager — so its invite / pending control waits (`seatAction`), and a
  // failed read is said, never an empty list.
  const invitesLoaded = invites.isSuccess
  // A stable "now" for invite expiry (14-day invites need no ticking clock).
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
  const teamOnline = useTeamOnline(detail.members)
  const selfSeat = model.seats.find((s) => s.isSelf) ?? null

  // The open seat sheet: which seat (by key, so it reads the live seat) and
  // a fresh mount per opening; kept mounted on close so it slides away.
  const [sheet, setSheet] = useState<{ seat: Seat; kind: 'manage' | 'invite' | 'pending'; n: number; open: boolean } | null>(null)
  const [linkSheet, setLinkSheet] = useState<{ which: 'slug' | 'rotate'; n: number; open: boolean } | null>(null)
  const [leaveStep, setLeaveStep] = useState<LeaveStep>('closed')

  const actionFor = (seat: Seat) =>
    seatAction(seat, {
      canManage,
      myRole: detail.my_role,
      seatUserId: detail.members.find((m) => m.id === seat.memberId)?.user_id ?? null,
      leagueOwnerId: detail.league.owner_id,
      invitesLoaded,
    })
  // The sheet keeps the kind it opened as (it closes once its action went
  // through — the row shows the result), and the live seat while it's there.
  const sheetSeat = sheet ? (model.seats.find((s) => s.key === sheet.seat.key) ?? sheet.seat) : null

  return (
    <MobileScreen header={header}>
      <div className="flex flex-col gap-[18px] px-4 pb-8 pt-3" data-members-screen>
        <p className="px-1 text-[13px] font-medium leading-[1.45] text-m-t3" data-members-intro>
          {canManage ? MEMBERS_INTRO_COMMISH : MEMBERS_INTRO_MEMBER}
        </p>

        {canManage && controls.shareLink && (
          <ShareLinkCard inviteCode={detail.league.invite_code} inviteSlug={detail.league.invite_slug}>
            <div className="flex flex-col border-t border-m-b3 px-3.5">
              <LinkRow
                label="Custom link"
                value={detail.league.invite_slug ? `/join/${detail.league.invite_slug}` : 'Not set'}
                onOpen={() => setLinkSheet((s) => ({ which: 'slug', n: (s?.n ?? 0) + 1, open: true }))}
                rowKey="slug"
              />
              <LinkRow label="Rotate link" onOpen={() => setLinkSheet((s) => ({ which: 'rotate', n: (s?.n ?? 0) + 1, open: true }))} rowKey="rotate" divided />
            </div>
          </ShareLinkCard>
        )}

        <section className="flex flex-col" aria-label="Teams" data-members-seats>
          <div className="flex items-center justify-between gap-3 px-1 pb-1.5">
            <h2 className="text-[13px] font-semibold text-m-t3">Teams</h2>
            <span className="text-[12px] font-medium tabular-nums text-m-t3">
              {model.claimedCount} / {model.total} claimed
            </span>
          </div>
          {/* The league link seats nobody once the draft has started — said
              where the link card was, for the commissioner. */}
          {canManage && controls.linkClosedNote && (
            <p className={cn(NOTE, 'px-1 pb-2')} data-link-closed>
              {controls.linkClosedNote}
            </p>
          )}
          {canManage && invites.isError && (
            <div className="pb-2" data-invites-error>
              <MNotice tone="error" action={{ label: 'Try again', onClick: () => void invites.refetch() }}>
                Couldn’t load invites.
              </MNotice>
            </div>
          )}
          <ul className="flex flex-col rounded-[16px] bg-m-b1 px-3.5" aria-label="Seats">
            {model.seats.map((seat) => {
              const action = actionFor(seat)
              return (
                <SeatRow
                  key={seat.key}
                  seat={seat}
                  leagueId={leagueId}
                  avatarClass={teamAvatarClass(seat.teamId, teamIds, myTeamId)}
                  online={teamOnline(seat.teamId)}
                  ringClass="ring-m-b1"
                  className="border-b border-m-b3 last:border-b-0"
                  note={action.kind === 'none' && action.note ? <span data-creator-seat>{action.note}</span> : undefined}
                  trailing={
                    action.kind === 'none' ? undefined : (
                      <button
                        type="button"
                        onClick={() => setSheet((s) => ({ seat, kind: action.kind, n: (s?.n ?? 0) + 1, open: true }))}
                        aria-label={seatActionLabel(action.kind, seat.teamName)}
                        aria-haspopup="dialog"
                        className="flex size-8 flex-none items-center justify-center rounded-full bg-m-b0 text-m-t1 active:bg-m-b2"
                        data-seat-more={action.kind}
                      >
                        <MIcon name="more" size={16} stroke={2.6} />
                      </button>
                    )
                  }
                />
              )
            })}
            {canManage && invites.isPending && <li className={cn(NOTE, 'py-2')}>Loading invites…</li>}
          </ul>
          {canManage && controls.addSeats && model.openCount > 0 && <AddSeats leagueId={leagueId} openCount={model.openCount} />}
        </section>

        {selfSeat && (
          <LeaveFoot
            mustTransferFirst={detail.my_role === 'commissioner'}
            onLeave={() => setLeaveStep((s) => nextLeaveStep(s, 'open'))}
          />
        )}
      </div>

      {sheet && sheetSeat && (
        <SeatSheet
          key={sheet.n}
          open={sheet.open}
          onOpenChange={(open) => setSheet((s) => (s ? { ...s, open } : s))}
          seat={sheetSeat}
          kind={sheet.kind}
          ctx={{ leagueId, leagueName: detail.league.name, myRole: detail.my_role, phase: controls.phase, nowMs }}
        />
      )}
      {canManage && linkSheet?.which === 'slug' && (
        <SlugSheet
          key={linkSheet.n}
          open={linkSheet.open}
          onOpenChange={(open) => setLinkSheet((s) => (s ? { ...s, open } : s))}
          leagueId={leagueId}
          inviteSlug={detail.league.invite_slug}
        />
      )}
      {canManage && linkSheet?.which === 'rotate' && (
        <RotateSheet key={linkSheet.n} open={linkSheet.open} onOpenChange={(open) => setLinkSheet((s) => (s ? { ...s, open } : s))} leagueId={leagueId} />
      )}
      {selfSeat && (
        <LeaveSheet step={leaveStep} onStep={setLeaveStep} leagueId={leagueId} seat={selfSeat} phase={controls.phase} leagueName={detail.league.name} />
      )}
    </MobileScreen>
  )
}

/** A row inside the share-link card: the label, its value, a chevron. */
function LinkRow({
  label,
  value,
  onOpen,
  rowKey,
  divided = false,
}: {
  label: string
  value?: string
  onOpen: () => void
  rowKey: string
  divided?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn('flex min-h-[44px] w-full items-center gap-3 py-2 text-left active:opacity-70', divided && 'border-t border-m-b3')}
      data-link-row={rowKey}
    >
      <span className="min-w-0 flex-1 text-[14px] font-medium text-m-t1">{label}</span>
      {value && <span className="max-w-[55%] truncate text-[13px] font-medium text-m-t3">{value}</span>}
      <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
    </button>
  )
}

/** Before the draft: add one seat, or fill every one still open (one press;
 *  the server's count ends the loop — `useFillSeats`). */
function AddSeats({ leagueId, openCount }: { leagueId: string; openCount: number }) {
  const { add, fillAll, fill, busy } = useFillSeats(leagueId)
  return (
    <div className="flex flex-col gap-2 pt-2.5" data-add-seats>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void add()} disabled={busy} className={cn(PILL, 'bg-m-b2 text-m-t1 active:bg-m-b2h')} data-add-seat>
          <MIcon name="plus" size={13} stroke={2} />
          Add an open seat
        </button>
        {/* Kept mounted through the last pass of a fill, so its progress
            doesn't vanish as the count drops (R961). */}
        {(openCount > 1 || fill !== null) && (
          <button
            type="button"
            onClick={() => void fillAll(openCount)}
            disabled={busy}
            className={cn(PILL, 'bg-accent text-white active:bg-accent-strong')}
            data-fill-seats
          >
            <MIcon name="plus" size={13} stroke={2} />
            {fillAllLabel(fill, openCount)}
          </button>
        )}
      </div>
      <p className={cn(NOTE, 'px-1')}>
        {openCount} seat{openCount === 1 ? '' : 's'} still open.
      </p>
    </div>
  )
}

/** Your own seat's Leave — greyed with why for the sitting commissioner, who
 *  must hand the role over first. */
function LeaveFoot({ mustTransferFirst, onLeave }: { mustTransferFirst: boolean; onLeave: () => void }) {
  return (
    <div className="flex flex-col gap-2" data-leave-foot>
      <button
        type="button"
        onClick={onLeave}
        disabled={mustTransferFirst}
        aria-haspopup="dialog"
        className="flex h-12 items-center justify-center rounded-[14px] bg-m-b1 text-[15px] font-semibold text-m-red active:bg-m-b2 disabled:text-m-t5 disabled:active:bg-m-b1"
        data-leave-league
      >
        Leave league
      </button>
      {mustTransferFirst && <p className={cn(NOTE, 'px-4 text-center')}>{LEAVE_BLOCKED_NOTE}</p>}
    </div>
  )
}
