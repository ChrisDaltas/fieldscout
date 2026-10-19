'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  COMMISH_LOG_EMPTY_COPY,
  commishLogLines,
  groupCommishLogLines,
  memberNamesOf,
} from '@/components/leagues/activity-feed-ops'
import {
  ALL_TEAMS_LABEL,
  ALL_WEEKS_LABEL,
  COMMISH_ENTRY_NOTE,
  COMMISH_FILTERED_EMPTY_COPY,
  COMMISH_WEEK_NOTE,
  SHOW_NEWEST_LABEL,
  TAB_INTRO_COPY,
  activityHref,
  parseActivityRoute,
  type ActivityRoute,
} from '@/components/leagues/activity-page-ops'
import { playerParts, type NamedPlayer } from '@/components/players/player-link-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { TextWithUsernames, UsernameLink } from '@/components/shared/username-link'
import { invalidateCommishLog, useCommishLog } from '@/hooks/use-commish-log'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { leagueActivityKeys } from '@/hooks/use-league-activity'
import { useLeagueChannel, type LeagueChannelHandlers } from '@/hooks/use-league-channel'
import { LEAGUE_CHANNEL_EVENTS, activityEventInvalidates } from '@/hooks/use-league-channel-ops'
import { useSchedule } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { MobileCorrections } from './corrections-list'
import { CenteredNote, FilterPill, StatusLine } from './league-bits'
import { commishLogHref, correctionsScreenHref, formatTxDate } from './league-tab-ops'

/**
 * The two League › Activity pages the mobile design has no screen for, kept
 * (CLAUDE.md: delete nothing) as full screens in the Transactions screen's
 * frame — their own addresses under `/activity/…`, so, like Transactions,
 * the dock shows no switcher and lights no tab: a 52px bar with a back
 * chevron and a centred title. Back goes back to where you came from — the
 * Activity list, a ✸ on Standings or a Match card (Chris #27) — and to
 * League › Activity only when the screen was opened fresh from a link.
 *  - Commissioner log (`/activity/commissioner`): every change a
 *    commissioner made, filterable by team and week, opened AT an entry by a
 *    ✸ door. Every member it names — the commissioner heading a row, the
 *    people in its sentence — is an @handle, as on the transaction rows
 *    (gap list §4 item 12).
 *  - Stat corrections (`/activity/corrections`, where `/corrections` and the
 *    desktop `?tab=corrections` land): the corrections list in the mobile
 *    language.
 */

/** The route's screen: the league read, then the subscreen. */
export function ActivitySubscreenRoute({ leagueId, initial }: { leagueId: string; initial: ActivityRoute }) {
  const league = useLeague(leagueId)
  // The address's own filters (they change without a server round trip); the
  // screen is fixed by the route.
  const searchParams = useSearchParams()
  const route: ActivityRoute = searchParams ? parseActivityRoute({ ...Object.fromEntries(searchParams.entries()), tab: initial.tab }) : initial
  const title = route.tab === 'commissioner' ? 'Commissioner log' : 'Stat corrections'
  if (!league.data) {
    return (
      <MobileScreen header={<SubscreenBar leagueId={leagueId} title={title} />}>
        {league.isPending ? (
          <CenteredNote message="Loading…" role="status" />
        ) : (
          <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void league.refetch()} />
        )}
      </MobileScreen>
    )
  }
  return route.tab === 'commissioner' ? (
    <CommishLogScreen leagueId={leagueId} detail={league.data} route={route} />
  ) : (
    <CorrectionsScreen leagueId={leagueId} detail={league.data} route={route} />
  )
}
function SubscreenBar({ leagueId, title }: { leagueId: string; title: string }) {
  const goBack = useGoBack()
  return (
    <div className="flex h-[52px] items-center gap-2 px-3">
      <button
        type="button"
        onClick={() => goBack(activityHref(leagueId))}
        aria-label="Back"
        className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
        data-subscreen-back
      >
        <MIcon name="back" size={18} stroke={2} />
      </button>
      <h2 className="flex-1 text-center text-[16px] font-semibold text-m-t1">{title}</h2>
      <span className="w-9 flex-none" />
    </div>
  )
}

export function CorrectionsScreen({ leagueId, detail, route }: { leagueId: string; detail: LeagueDetail; route: ActivityRoute }) {
  const router = useRouter()
  return (
    <MobileScreen header={<SubscreenBar leagueId={leagueId} title="Stat corrections" />}>
      <div className="px-3 pb-5 pt-1">
        <MobileCorrections
          key={route.week ?? 'all'}
          leagueId={leagueId}
          initialWeek={route.week}
          leagueTimeZone={detail.settings.draft.time_zone ?? null}
          onWeekChange={(week) => router.replace(correctionsScreenHref(leagueId, week), { scroll: false })}
        />
      </div>
    </MobileScreen>
  )
}

export function CommishLogScreen({ leagueId, detail, route }: { leagueId: string; detail: LeagueDetail; route: ActivityRoute }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState(false)
  const log = useCommishLog(leagueId, {
    limit: 50,
    ...(route.team ? { team_id: route.team } : {}),
    ...(route.week !== null ? { week: route.week } : {}),
    ...(route.entry ? { entry: route.entry } : {}),
  })
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    invalidateCommishLog(queryClient, leagueId)
  }
  const handlers: LeagueChannelHandlers = {}
  for (const event of LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)) handlers[event] = invalidate
  const { connection } = useLeagueChannel(leagueId, handlers, { onJoin: invalidate, onDrop: invalidate })

  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const memberNames = useMemo(() => memberNamesOf(detail.members), [detail.members])
  const items = log.data?.pages.flatMap((p) => p.items)
  const groups = useMemo(() => (items ? groupCommishLogLines(items, commishLogLines(items, teamNames, memberNames)) : null), [items, teamNames, memberNames])
  const filtered = route.team !== null || route.week !== null
  const go = (next: ActivityRoute) => router.replace(commishLogHref(leagueId, next), { scroll: false })
  const count = (route.team ? 1 : 0) + (route.week !== null ? 1 : 0)

  const highlighted = useRef<HTMLDivElement | null>(null)
  const highlightShown = route.entry !== null && (groups ?? []).some((g) => g.entries.some((l) => l.id === route.entry))
  useEffect(() => {
    if (highlightShown) highlighted.current?.scrollIntoView?.({ block: 'center' })
  }, [highlightShown])

  const header = (
    <>
      <SubscreenBar leagueId={leagueId} title="Commissioner log" />
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-m-t3">
          {[route.team ? (teamNames.get(route.team) ?? 'One team') : ALL_TEAMS_LABEL, route.week !== null ? `Week ${route.week}` : ALL_WEEKS_LABEL].join(' · ')}
        </span>
        <FilterPill count={count} label={count > 0 ? `Filter · ${count}` : 'Filter'} onClick={() => setSheet(true)} />
      </div>
    </>
  )

  return (
    <MobileScreen header={header}>
      <div className="flex flex-col px-3 pb-5" data-commish-log-screen>
        <p className="px-1 pb-2 text-[12px] font-medium leading-[1.35] text-m-t3">{TAB_INTRO_COPY.commissioner}</p>
        {route.week !== null && <p className="px-1 pb-2 text-[12px] font-medium leading-[1.35] text-m-t3">{COMMISH_WEEK_NOTE}</p>}
        {route.entry && (
          <div className="mb-2 flex items-center gap-3 rounded-[12px] bg-m-gb px-3 py-2.5">
            <span className="min-w-0 flex-1 text-[12px] font-semibold text-m-tb">{COMMISH_ENTRY_NOTE}</span>
            <button type="button" onClick={() => go({ ...route, entry: null })} className="flex-none text-[13px] font-semibold text-accent">
              {SHOW_NEWEST_LABEL}
            </button>
          </div>
        )}
        {connection === 'reconnecting' && <StatusLine>Reconnecting — syncing this league…</StatusLine>}
        {log.isPending ? (
          <CenteredNote message="Loading…" role="status" />
        ) : !groups ? (
          <CenteredNote role="alert" message="Couldn’t load the commissioner actions." action="Try again" onAction={() => void log.refetch()} />
        ) : groups.length === 0 ? (
          <CenteredNote message={filtered || route.entry ? COMMISH_FILTERED_EMPTY_COPY : COMMISH_LOG_EMPTY_COPY} />
        ) : (
          groups.map(({ line, entries }) => {
            const hit = route.entry !== null && entries.some((l) => l.id === route.entry)
            return (
              <div
                key={line.id}
                ref={hit ? highlighted : undefined}
                className={cn('flex flex-col gap-1 border-b border-m-b2 px-1 py-3', hit && 'rounded-[12px] border-transparent bg-m-gb px-3')}
                data-commish-line={line.id}
              >
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-m-t3">
                  {line.actorUsername ? (
                    <UsernameLink username={line.actorUsername} className="font-semibold text-m-t1" />
                  ) : (
                    <span className="font-semibold text-m-t1">{line.actor}</span>
                  )}
                  <span className="flex h-[18px] items-center rounded-pill bg-m-gp px-[7px] text-[10.5px] font-semibold text-m-pos-wr">✸ Commissioner</span>
                  <span className="whitespace-nowrap">{formatTxDate(line.createdAt)}</span>
                </div>
                <p className="text-[13.5px] font-medium leading-[1.4] text-m-t1">
                  <TextWithUsernames
                    marked={line.marked}
                    at
                    linkClassName="font-semibold"
                    renderText={(t) => <MobilePlayerText text={t} players={line.players} leagueId={leagueId} />}
                  />
                </p>
                {line.reason && <p className="text-[12px] font-medium text-m-t3">Reason: {line.reason}</p>}
              </div>
            )
          })
        )}
        {log.hasNextPage && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={() => void log.fetchNextPage()}
              disabled={log.isFetchingNextPage}
              className="text-[14px] font-semibold text-accent disabled:text-m-t4"
            >
              {log.isFetchingNextPage ? 'Loading…' : log.isFetchNextPageError ? 'Couldn’t load older actions — try again' : 'Show older'}
            </button>
          </div>
        )}
      </div>
      <CommishFilterSheet open={sheet} onOpenChange={setSheet} leagueId={leagueId} detail={detail} route={route} onRoute={go} />
    </MobileScreen>
  )
}

function CommishFilterSheet({
  open,
  onOpenChange,
  leagueId,
  detail,
  route,
  onRoute,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  detail: LeagueDetail
  route: ActivityRoute
  onRoute: (next: ActivityRoute) => void
}) {
  const schedule = useSchedule(leagueId)
  const weeks = [...new Set([...(schedule.data?.weeks ?? []).map((w) => w.week), ...(route.week !== null ? [route.week] : [])])].sort((a, b) => a - b)
  const chip = (on: boolean) => cn('flex h-9 flex-none items-center whitespace-nowrap rounded-pill px-4 text-[13px] font-semibold', on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1')
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log filters"
      footer={
        <div className="px-5 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-[50px] w-full items-center justify-center rounded-pill bg-accent text-[16px] font-semibold text-white active:bg-accent-strong"
          >
            Done
          </button>
        </div>
      }
    >
      <p className="px-5 pb-1.5 text-[12px] font-semibold text-m-t3">Week</p>
      <div className="flex gap-1.5 overflow-x-auto px-5 pb-3.5 scrollbar-none">
        <button type="button" aria-pressed={route.week === null} onClick={() => onRoute({ ...route, week: null, entry: null })} className={chip(route.week === null)}>
          {ALL_WEEKS_LABEL}
        </button>
        {weeks.map((w) => (
          <button key={w} type="button" aria-pressed={route.week === w} onClick={() => onRoute({ ...route, week: w, entry: null })} className={chip(route.week === w)}>
            Week {w}
          </button>
        ))}
      </div>
      <p className="px-5 pb-1 text-[12px] font-semibold text-m-t3">Team</p>
      {[{ id: null as string | null, name: ALL_TEAMS_LABEL }, ...detail.teams.map((t) => ({ id: t.id as string | null, name: t.name }))].map((t) => {
        const on = route.team === t.id
        return (
          <button
            key={t.id ?? 'all'}
            type="button"
            aria-pressed={on}
            onClick={() => onRoute({ ...route, team: t.id, entry: null })}
            className="mx-5 flex h-12 w-[calc(100%-40px)] items-center gap-3 border-b border-m-b2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{t.name}</span>
            <span
              aria-hidden="true"
              className={cn('flex size-[22px] flex-none items-center justify-center rounded-full', on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m')}
            >
              {on && <MIcon name="check" size={11} stroke={3} className="text-white" />}
            </span>
          </button>
        )
      })}
    </MobileSheet>
  )
}

/** F563: a player the commissioner-log sentence names is a door — on a phone
 *  a tap opens his full profile (the mobile rule; desktop opens the mini card). */
function MobilePlayerText({ text, players, leagueId }: { text: string; players: readonly NamedPlayer[]; leagueId: string }) {
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  return (
    <>
      {playerParts(text, players).map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="font-semibold text-m-t1 underline decoration-transparent underline-offset-2"
            onClick={() => openPlayerView(part.playerId, leagueId)}
            data-player-link={part.playerId}
          >
            {part.name}
          </button>
        ),
      )}
    </>
  )
}
