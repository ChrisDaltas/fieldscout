'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { AttachListInline } from '@/components/leagues/attach-list-modal'
import { deriveSeats, memberControls, membersPageHref } from '@/components/leagues/invite-panel-ops'
import { SettingsSkin } from '@/components/leagues/settings-form-controls'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueInvites } from '@/hooks/use-league-invites'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { useTeamOnline } from '@/hooks/use-online'
import { cn } from '@/lib/utils'

import { SeatRow, ShareLinkCard } from '../members/seat-parts'

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
 * The practice drafts' rows are `PracticeRow` (`mobile/mocks/practice-row`),
 * shared with the phone's practice home.
 */

const PILL = 'flex h-9 flex-none items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold'
const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

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

      {canManage && controls.shareLink && <ShareLinkCard inviteCode={detail.league.invite_code} inviteSlug={detail.league.invite_slug} />}
      {canManage && controls.linkClosedNote && <p className={cn(NOTE, 'px-1')}>{controls.linkClosedNote}</p>}

      <ul className="flex flex-col rounded-[16px] bg-m-b1 px-3.5" aria-label="Seats">
        {model.seats.map((seat) => (
          <SeatRow
            key={seat.key}
            seat={seat}
            leagueId={leagueId}
            avatarClass={teamAvatarClass(seat.teamId, teamIds, myTeamId)}
            online={teamOnline(seat.teamId)}
            ringClass="ring-m-b1"
            className="border-b border-m-b3 last:border-b-0"
          />
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
