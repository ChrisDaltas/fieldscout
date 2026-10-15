'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

import { teamPageHref } from '@/components/leagues/league-cells'
import {
  CHAMPION_UNRECORDED_COPY,
  NO_SEAT_COPY,
  championName,
  draftDoors,
  setLineupCopy,
  tradeChip,
  waiverChip,
} from '@/components/leagues/league-home-season-ops'
import {
  FORMER_MEMBER_LABEL,
  MESSAGE_BOARD_EMPTY_COPY,
  MESSAGE_BOARD_ERROR_COPY,
  postErrorCopy,
} from '@/components/leagues/league-message-board'
import { formatInstantWithDate, formatKickoff } from '@/components/leagues/lineup-editor-ops'
import { tradesHref } from '@/components/leagues/trades-ops'
import { leagueTabHref } from '@/components/mobile/shell/mobile-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { UsernameLink } from '@/components/shared/username-link'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueChat, useSendLeagueChat } from '@/hooks/use-league-chat'

import { CenteredNote } from './league-bits'

/**
 * League-home content the mobile design does not draw, kept and restyled in
 * the mobile language (CLAUDE.md: restyle, delete nothing): the "Your team"
 * card (Set lineup, Add / drop, the lock record, the waiver and trade
 * chips), the league message board, the draft doors and the champion.
 */

const CARD = 'flex flex-col gap-3 rounded-[16px] bg-m-b1 p-3.5'
const H = 'text-[15px] font-semibold text-m-t1'
const PRIMARY = 'flex h-9 items-center rounded-pill bg-accent px-4 text-[13px] font-semibold text-white active:bg-accent-strong'
const SECONDARY = 'flex h-9 items-center rounded-pill bg-m-b0 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2'
const CHIP = 'flex h-7 items-center rounded-pill bg-m-b0 px-3 text-[11.5px] font-semibold text-m-t2'

export function YourTeamCard({
  leagueId,
  detail,
  myTeamId,
  week,
  lineup,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  week: number | null
  /** `undefined` while reading; `null` = nothing set for the week. */
  lineup: { locked_at: string | null } | null | undefined
}) {
  const tz = detail.settings.draft.time_zone ?? null
  const locksAt = lineup?.locked_at ? formatKickoff(lineup.locked_at, tz) : null
  const waivers = waiverChip(detail.settings, detail.waiver_window ?? null, (iso) => formatInstantWithDate(iso, tz).local)
  const trades = tradeChip(detail.settings)
  return (
    <section className={CARD} aria-label="Your team" data-your-team>
      <h2 className={H}>Your team</h2>
      {myTeamId ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href={leagueTabHref(leagueId, 'team', myTeamId)} className={PRIMARY}>
              Set lineup
            </Link>
            <Link href={leagueTabHref(leagueId, 'players', myTeamId)} className={SECONDARY}>
              Add / drop players
            </Link>
          </div>
          <p className="text-[12px] font-medium text-m-t3" title={locksAt?.title ?? undefined}>
            {week !== null && <>Week {week} · </>}
            {setLineupCopy(lineup, locksAt?.local ?? null)}
          </p>
        </>
      ) : (
        <p className="text-[13px] font-medium text-m-t3">{NO_SEAT_COPY}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <span className={CHIP} title={waivers.title}>
          {waivers.label}
        </span>
        <Link href={tradesHref(leagueId)} className={`${CHIP} gap-1 active:bg-m-b2`} title={trades.title}>
          <MIcon name="trade" size={12} stroke={1.6} />
          {trades.label}
        </Link>
      </div>
    </section>
  )
}

export function MessageBoardCard({ leagueId, detail, viewerId }: { leagueId: string; detail: LeagueDetail; viewerId: string | null }) {
  const chat = useLeagueChat(leagueId)
  const send = useSendLeagueChat(leagueId, viewerId)
  const [draft, setDraft] = useState('')
  const members = new Map(detail.members.filter((m) => m.user_id).map((m) => [m.user_id as string, m.profiles]))
  const tz = detail.settings.draft.time_zone ?? null
  const isMember = viewerId !== null && members.has(viewerId)
  const rows = chat.data ?? []

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || send.isPending) return
    send.mutate(text, { onSuccess: () => setDraft('') })
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Message board" data-message-board>
      <h2 className="px-1 text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Message board</h2>
      <div className={CARD}>
        {chat.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-[10px] bg-m-b2" />
            ))}
          </div>
        ) : chat.isError && !chat.data ? (
          <CenteredNote role="alert" message={MESSAGE_BOARD_ERROR_COPY} action="Try again" onAction={() => void chat.refetch()} className="py-4" />
        ) : rows.length === 0 ? (
          <p className="py-2 text-center text-[13px] font-medium text-m-t3">{MESSAGE_BOARD_EMPTY_COPY}</p>
        ) : (
          <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {rows.map((row) => {
              const profile = row.user_id ? (members.get(row.user_id) ?? null) : null
              const when = row.created_at ? formatInstantWithDate(row.created_at, tz) : null
              return (
                <li key={row.id} className="flex items-start gap-2.5">
                  <UserAvatar src={profile?.avatar_url ?? null} name={profile?.username ?? null} className="size-7 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-[13px] font-semibold text-m-t1">
                      {profile?.username ? <UsernameLink username={profile.username} /> : <span className="text-m-t3">{FORMER_MEMBER_LABEL}</span>}
                      {when && (
                        <span className="text-[11px] font-medium tabular-nums text-m-t3" title={when.title ?? undefined}>
                          {when.local}
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[14px] font-medium leading-[1.4] text-m-t1">{row.message}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {isMember && (
          <form onSubmit={onSubmit} className="flex h-11 items-center gap-1.5 rounded-pill bg-m-b0 pl-4 pr-[5px]">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the league"
              maxLength={500}
              aria-label="Message the league"
              className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-medium text-m-t1 outline-none placeholder:text-m-t4"
            />
            <button
              type="submit"
              disabled={!draft.trim() || send.isPending}
              aria-label="Post"
              className="flex size-[34px] flex-none items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
            >
              <MIcon name="sendUp" size={14} stroke={2.2} />
            </button>
          </form>
        )}
        {send.isError && (
          <p role="alert" className="text-[12px] font-semibold text-negative-strong">
            {postErrorCopy(send.error)}
          </p>
        )}
      </div>
    </section>
  )
}

/** The two post-draft doors: the draft record and the practice drafts. */
export function DraftDoorsCard({ leagueId, complete }: { leagueId: string; complete: boolean }) {
  const doors = draftDoors(leagueId)
  return (
    <section className={CARD} aria-label={complete ? 'History' : 'Draft'} data-draft-doors>
      <h2 className={H}>{complete ? 'History' : 'Draft'}</h2>
      <div className="flex flex-wrap gap-2">
        <Link href={doors.recap} className={complete ? PRIMARY : SECONDARY}>
          {complete ? 'View History' : 'Draft recap'}
        </Link>
        <Link href={doors.practice} className={SECONDARY}>
          Practice drafts
        </Link>
      </div>
      <p className="text-[12px] font-medium leading-[1.35] text-m-t3">
        {complete
          ? 'The final draft board and every roster as drafted. Practice drafts you kept stay in the launcher.'
          : 'The final board and every roster as drafted; practice drafts you kept stay in the launcher.'}
      </p>
    </section>
  )
}

/** The season's champion — the stored id, or the honest absence. */
export function ChampionCard({ detail }: { detail: LeagueDetail }) {
  const champion = championName(detail)
  return (
    <section className="flex flex-col items-center gap-1 rounded-[16px] bg-m-b1 px-4 py-6 text-center" aria-label="Champion" data-champion>
      <span className="text-[12px] font-semibold text-m-t3">{detail.league.season} champion</span>
      {champion && detail.league.champion_team_id ? (
        <Link href={teamPageHref(detail.league.id, detail.league.champion_team_id)} className="text-[19px] font-semibold tracking-[-0.02em] text-m-t1">
          {champion}
        </Link>
      ) : (
        <span className="text-[13px] font-medium text-m-t3">{CHAMPION_UNRECORDED_COPY}</span>
      )}
    </section>
  )
}
