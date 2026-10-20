'use client'

import Link from 'next/link'

import { buildJoinLink, preferredShareCode, type Seat } from '@/components/leagues/invite-panel-ops'
import { copyWithToast } from '@/components/leagues/invite-panel-actions'
import { teamPageHref } from '@/components/leagues/league-cells'
import { UsernameLink } from '@/components/shared/username-link'
import { cn } from '@/lib/utils'

import { TeamAvatar } from '../league/league-bits'

/**
 * The phone's seat pieces, shared by the pre-draft League tab's Managers
 * card and the Members screen (gap list §4 item 106): one seat row and the
 * league share-link card. Every seat comes from `deriveSeats` — a claimed
 * seat shows its team and its manager's @handle (a profile door), an invited
 * seat the invite, never a claimed seat's email.
 */

const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'

export const SEAT_PILL: Record<Seat['status'], { label: string; cls: string }> = {
  claimed: { label: 'Claimed', cls: 'bg-m-gg text-m-tg' },
  invited: { label: 'Invited', cls: 'bg-m-gb text-m-tb' },
  placeholder: { label: 'Open', cls: 'bg-m-b2 text-m-t3' },
  open: { label: 'Open', cls: 'bg-m-b2 text-m-t3' },
}

/**
 * One seat: the team's avatar (with its manager's online dot), the team
 * name as a door to its page, the seat line, the status pill — and, where
 * the screen offers one, a trailing control (`trailing`) and a note under
 * the line (`note`). `ringClass` matches the online dot's ring to the
 * surface the row sits on.
 */
export function SeatRow({
  seat,
  leagueId,
  avatarClass,
  online,
  ringClass,
  className,
  note,
  trailing,
}: {
  seat: Seat
  leagueId: string
  avatarClass: string
  online: boolean
  ringClass: string
  className?: string
  note?: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <li className={cn('flex min-h-[56px] items-center gap-3 py-2', className)} data-seat={seat.status}>
      {seat.status === 'open' || !seat.teamId ? (
        <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-m-t5 text-[11px] font-semibold text-white">
          •
        </span>
      ) : (
        <TeamAvatar name={seat.teamName} size={32} className={avatarClass} online={online} onlineRingClass={ringClass} />
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
        {note ? <span className={cn(NOTE, 'pt-0.5')}>{note}</span> : null}
      </span>
      <span className={cn('flex h-[20px] flex-none items-center rounded-pill px-2 text-[11px] font-semibold', SEAT_PILL[seat.status].cls)}>
        {SEAT_PILL[seat.status].label}
      </span>
      {trailing}
    </li>
  )
}

/** The seat's second line: its manager (a profile door), you, the role; the
 *  invite; or that it has no manager. */
export function SeatLine({ seat }: { seat: Seat }) {
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

/**
 * The league share link with Copy (commissioner, before the draft). The
 * Members screen adds its own rows under it (`children` — the custom link
 * and rotate), inside the same card.
 */
export function ShareLinkCard({
  inviteCode,
  inviteSlug,
  children,
}: {
  inviteCode: string | null
  inviteSlug: string | null
  children?: React.ReactNode
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const code = preferredShareCode(inviteSlug, inviteCode)
  const link = code ? buildJoinLink(origin, code) : null
  return (
    <div className="flex flex-col rounded-[16px] bg-m-b1" data-share-link>
      <div className="flex flex-col gap-2 p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[14px] font-semibold text-m-t1">Invite link</span>
            <span className="truncate text-[12px] font-medium text-m-t3">{link ?? 'No link yet'}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              if (link) void copyWithToast(link, 'Invite link copied')
            }}
            disabled={!link}
            aria-label="Copy the league share link"
            className="flex h-8 flex-none items-center rounded-pill bg-m-b0 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2 disabled:opacity-50"
          >
            Copy
          </button>
        </div>
        <p className={NOTE}>Anyone with this link can claim an open seat — paste it into any chat or email.</p>
      </div>
      {children}
    </div>
  )
}
