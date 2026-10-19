'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useRef } from 'react'

import { memberNamesOf } from '@/components/leagues/activity-feed-ops'
import { managersByTeam } from '@/components/leagues/league-home-season-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { TextWithActor, UsernameLink } from '@/components/shared/username-link'
import type { LeagueDetail } from '@/hooks/use-league'
import { useMobileLeagueActivity } from '@/hooks/use-mobile-league-activity'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { shortPlayerName } from '@/utils/format-name'

import { CenteredNote, StatusLine } from './league-bits'
import {
  claimResultRows,
  commishLogHref,
  emptyFilterCopy,
  feedRows,
  feedStreams,
  formatTxDate,
  moveSub,
  rowPlayerIds,
  withClaimResults,
  type MoveLine,
  type Pill,
  type PostRow,
  type TextPart,
  type TxFilter,
  type TxRow,
  type WhoOf,
} from './league-tab-ops'

/** Read older pages on their own until this many rows show (a team filter
 *  keeps only part of a league-wide read), at most this many pages. */
const FILL_ROWS = 12
const FILL_PAGES = 8

/** Your settled claims for My moves (the screen's `GET …/waivers?status=all`
 *  read): the lost and failed ones join the list. `refresh` re-reads them —
 *  claims are never broadcast, so a new move at the top of the feed (a
 *  waiver run's wins arrive that way) is the cue that a run may have
 *  settled yours too. */
export interface TxClaimResults {
  claims: readonly WaiverClaimView[]
  waiverType: string | null
  refresh: () => void
}

/**
 * The transaction list (handoff m-league §2.5 item 5): one row per act,
 * newest first — the manager, the type pill, the date and any winning bid,
 * then one line per player added or dropped (headshot with the team ring,
 * short name, position · team, Added / Dropped). League notices and the
 * commissioner's posts are rows too (the feed is the league's whole
 * activity). Shared by League › Activity and the Transactions screen.
 *
 * Project rules over the prototype: a manager — at the head of a row or
 * inside its words ("Trade with @marcus") — is his @handle (the prototype's
 * bare "marcus" is gone: one handle format across the League tab, gap list
 * §4 item 12) and a door to his profile, and a player line opens that
 * player's profile. A filtered-to-teams list
 * tells each trade from the selected team's side. "No … match" is said only
 * once the feed is read to its end.
 */
export function TxFeed({
  leagueId,
  detail,
  myTeamId,
  filter,
  myMoves,
  onClear,
  claimResults = null,
  claimsPending = false,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  filter: TxFilter
  myMoves: boolean
  onClear: () => void
  /** My moves under All types / Waivers: your lost and failed claims. */
  claimResults?: TxClaimResults | null
  /** Those claims are still being read (alongside the feed): hold the rows
   *  so a claim never pops in among moves already shown. */
  claimsPending?: boolean
}) {
  const streams = useMemo(() => feedStreams(filter, myMoves, myTeamId), [filter, myMoves, myTeamId])
  const feed = useMobileLeagueActivity(leagueId, streams)
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const memberNames = useMemo(() => memberNamesOf(detail.members), [detail.members])
  const who = useMemo<WhoOf>(
    () => (teamId) => {
      if (!teamId) return null
      const username = managers.get(teamId)
      return username ? { username } : (teamNames.get(teamId) ?? null)
    },
    [managers, teamNames],
  )
  const perspective = useMemo(() => (myMoves ? (myTeamId ? [myTeamId] : []) : filter.teams), [myMoves, myTeamId, filter.teams])
  const rows = useMemo(
    () => (feed.items ? feedRows(feed.items, teamNames, memberNames, who, perspective) : null),
    [feed.items, teamNames, memberNames, who, perspective],
  )
  const claimRows = useMemo(
    () => (claimResults ? claimResultRows(claimResults.claims, claimResults.waiverType, who) : []),
    [claimResults, who],
  )
  const shown = useMemo(() => (rows ? withClaimResults(rows, claimRows, !feed.hasNextPage) : null), [rows, claimRows, feed.hasNextPage])
  const ids = useMemo(() => (shown ? rowPlayerIds(shown) : []), [shown])
  const players = usePlayersByIds(ids)
  const filtered = filter.type !== 'All' || (!myMoves && filter.teams.length > 0)

  // A filtered list can come back short (or empty) while older moves are
  // still unread: keep reading, a page at a time, before saying "no match".
  const pagesRead = feed.data?.pages.length ?? 0
  const filling =
    rows !== null && feed.hasNextPage && !feed.isFetchNextPageError && rows.length < FILL_ROWS && pagesRead < FILL_PAGES
  const { fetchNextPage, isFetchingNextPage } = feed
  useEffect(() => {
    if (filling && !isFetchingNextPage) void fetchNextPage()
  }, [filling, isFetchingNextPage, fetchNextPage])

  // A new move at the top of the same list (not its first read, not a new
  // filter): re-read your claims.
  const top = rows === null ? undefined : (rows[0]?.id ?? '')
  const seenTop = useRef<{ streams: typeof streams; top: string } | null>(null)
  const refreshClaims = claimResults?.refresh
  useEffect(() => {
    if (top === undefined) return
    const seen = seenTop.current
    if (seen && seen.streams === streams && seen.top !== top) refreshClaims?.()
    seenTop.current = { streams, top }
  }, [top, streams, refreshClaims])

  if (myMoves && !myTeamId) {
    return <CenteredNote message="You don’t manage a team in this league." />
  }
  if (feed.isPending || claimsPending || (rows !== null && rows.length === 0 && filling)) return <RowSkeleton />
  if (!rows || !shown) {
    return <CenteredNote role="alert" message="Couldn’t load the activity." action="Try again" onAction={() => void feed.refetch()} />
  }

  return (
    <div data-tx-feed>
      {feed.connection === 'reconnecting' && (
        <div className="pb-2 pt-1">
          <StatusLine>Reconnecting — syncing this league…</StatusLine>
        </div>
      )}
      {feed.isError && !feed.isFetchNextPageError && (
        <div className="pb-2 pt-1">
          <StatusLine>Activity isn’t refreshing — showing the last moves we read.</StatusLine>
        </div>
      )}
      {shown.map((row) =>
        row.kind === 'transaction' ? (
          <TxRowView key={row.id} leagueId={leagueId} row={row} who={who} playerById={players.playerById} />
        ) : (
          <PostRowView key={row.id} leagueId={leagueId} row={row} />
        ),
      )}
      {shown.length === 0 &&
        !feed.hasNextPage &&
        (filtered ? (
          <CenteredNote message={emptyFilterCopy(myMoves)} action="Clear filter" onAction={onClear} />
        ) : (
          <CenteredNote message={myMoves ? 'No moves yet this season.' : 'Nothing has happened in this league yet.'} />
        ))}
      {shown.length === 0 && feed.hasNextPage && (
        <CenteredNote message="Nothing matches in the newest moves." className="pb-0" />
      )}
      {feed.hasNextPage && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={() => void feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="text-[14px] font-semibold text-accent disabled:text-m-t4"
          >
            {feed.isFetchingNextPage ? 'Loading…' : feed.isFetchNextPageError ? 'Couldn’t load older moves — try again' : 'Show older'}
          </button>
        </div>
      )}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-m-b2 px-1 py-3">
          <div className="h-[18px] w-48 animate-pulse rounded-pill bg-m-b1" />
          <div className="flex items-center gap-2.5">
            <span className="size-8 animate-pulse rounded-full bg-m-b1" />
            <span className="h-8 flex-1 animate-pulse rounded-[10px] bg-m-b1" />
          </div>
        </div>
      ))}
    </div>
  )
}

const PILL_TONE: Record<Pill['tone'], string> = {
  trade: 'bg-m-gb text-m-tb',
  waiver: 'bg-m-go text-m-gold',
  free: 'bg-m-gg text-m-green',
  commish: 'bg-m-gp text-m-pos-wr',
  league: 'bg-m-b2 text-m-t3',
  correction: 'bg-m-go text-m-to',
}

function TypePill({ pill, href }: { pill: Pill; href?: string | null }) {
  const cls = cn('flex h-[18px] flex-none items-center whitespace-nowrap rounded-pill px-[7px] text-[10.5px] font-semibold', PILL_TONE[pill.tone])
  return href ? (
    <Link href={href} className={cls} title="Open this entry in the commissioner log">
      {pill.label}
    </Link>
  ) : (
    <span className={cls}>{pill.label}</span>
  )
}

/** Words with managers in them — each manager an @handle and a door to his
 *  profile (gap list §4 item 12). */
function Parts({ parts, linkClassName }: { parts: readonly TextPart[]; linkClassName?: string }) {
  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <UsernameLink key={i} username={part.username} className={linkClassName} />
        ),
      )}
    </>
  )
}

function TxRowView({
  leagueId,
  row,
  who,
  playerById,
}: {
  leagueId: string
  row: TxRow
  who: WhoOf
  playerById: ReadonlyMap<string, PlayerIdentity>
}) {
  const head = who(row.teamId)
  const entry = row.commishActionId ? commishLogHref(leagueId, { entry: row.commishActionId }) : null
  return (
    <div className="flex flex-col gap-2 border-b border-m-b2 px-1 py-3" data-tx-row={row.id} data-claim-result={row.result?.status}>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-m-t3">
        {head && typeof head !== 'string' ? (
          <UsernameLink username={head.username} className="min-w-0 truncate font-semibold text-m-t1" />
        ) : (
          <span className="min-w-0 truncate font-semibold text-m-t1">{head ?? 'Commissioner'}</span>
        )}
        <TypePill pill={row.pill} href={row.pill.tone === 'commish' ? entry : null} />
        {row.result && <span className="flex-none whitespace-nowrap font-semibold text-m-tr">{row.result.label}</span>}
        {entry && row.pill.tone !== 'commish' && (
          <Link href={entry} className="flex-none font-semibold text-m-pos-wr" title="Done by the commissioner — open the log entry">
            ✸
          </Link>
        )}
        <span className="flex-none whitespace-nowrap">{formatTxDate(row.createdAt)}</span>
        <span className="flex-1" />
        {row.bid !== null && <span className="flex-none text-[13px] font-semibold tabular-nums text-m-t1">${row.bid} bid</span>}
      </div>
      {row.moves.map((m) => (
        <MoveLineView key={m.key} leagueId={leagueId} move={m} player={m.playerId ? (playerById.get(m.playerId) ?? null) : null} />
      ))}
      {row.text &&
        (row.moves.length > 0 ? (
          <p className="text-[11.5px] font-medium text-m-t3">
            <Parts parts={row.text} linkClassName="font-semibold text-m-t1" />
          </p>
        ) : (
          <p className="text-[13.5px] font-medium leading-[1.4] text-m-t1">
            <Parts parts={row.text} linkClassName="font-semibold" />
          </p>
        ))}
    </div>
  )
}

function MoveLineView({ leagueId, move, player }: { leagueId: string; move: MoveLine; player: PlayerIdentity | null }) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const name = move.name || player?.full_name || 'Unknown player'
  const position = move.position ?? player?.position ?? null
  const nflTeam = move.nflTeam ?? player?.team ?? null
  const sub = moveSub(position, nflTeam)
  const tone = move.tone === 'add' ? 'text-m-green' : 'text-m-red'
  // The whole line opens the player (a stretched button, painted last); a
  // manager named in the note sits above it as his own door.
  return (
    <div className="relative flex w-full items-center gap-2.5">
      <span className="flex w-4 flex-none justify-center">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true" className={move.muted ? 'text-m-t4' : tone}>
          <path d={move.tone === 'add' ? 'M8 3.5v9M3.5 8h9' : 'M3.5 8h9'} />
        </svg>
      </span>
      <MHeadshot
        player={{ id: move.playerId, full_name: name, team: nflTeam, position, headshot_url: player?.headshot_url ?? null }}
        size={32}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold text-m-t1">{shortPlayerName(name, position)}</span>
        {(sub || move.note) && (
          <span className="truncate text-[11px] font-medium text-m-t3">
            {sub}
            {sub && move.note ? ' · ' : null}
            {move.note && <Parts parts={move.note} linkClassName="relative z-[1] font-semibold" />}
          </span>
        )}
      </span>
      <span className={cn('flex-none text-[11px] font-semibold', move.muted ? 'text-m-t3' : tone)}>{move.verb}</span>
      {move.playerId && (
        <button
          type="button"
          onClick={() => openPlayer(move.playerId!, leagueId)}
          className="absolute inset-0"
          aria-label={`${name} — ${move.verb}`}
        />
      )}
    </div>
  )
}

function PostRowView({ leagueId, row }: { leagueId: string; row: PostRow }) {
  const entry = row.commishActionId ? commishLogHref(leagueId, { entry: row.commishActionId }) : null
  return (
    <div className="flex flex-col gap-1.5 border-b border-m-b2 px-1 py-3" data-post-row={row.id}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-m-t3">
        <TypePill pill={row.pill} href={row.pill.tone === 'commish' ? entry : null} />
        <span className="whitespace-nowrap">{formatTxDate(row.createdAt)}</span>
      </div>
      <p className="text-[13.5px] font-medium leading-[1.4] text-m-t1">
        <TextWithActor text={row.text} actor={row.actorUsername} at linkClassName="font-semibold" />
      </p>
    </div>
  )
}

