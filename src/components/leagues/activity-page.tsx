'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { invalidateCommishLog, useCommishLog } from '@/hooks/use-commish-log'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { leagueActivityKeys, useLeagueActivityPages, type ActivityFilters } from '@/hooks/use-league-activity'
import { useLeagueChannel, type LeagueChannelHandlers } from '@/hooks/use-league-channel'
import { LEAGUE_CHANNEL_EVENTS, activityEventInvalidates } from '@/hooks/use-league-channel-ops'
import { useSchedule } from '@/hooks/use-schedule'

import { ActivityFeed, CommishLogSection } from './activity-feed'
import { memberNamesOf } from './activity-feed-ops'
import {
  ACTIVITY_PAGE_TITLE,
  ACTIVITY_TABS,
  ACTIVITY_TAB_LABELS,
  ADD_DROP_TYPES,
  ALL_TEAMS_LABEL,
  COMMISH_ENTRY_NOTE,
  COMMISH_FILTERED_EMPTY_COPY,
  COMMISH_WEEK_NOTE,
  SHOW_NEWEST_LABEL,
  TAB_EMPTY_COPY,
  TAB_INTRO_COPY,
  activityHref,
  activityRouteFrom,
  type ActivityRoute,
  type ActivityTab,
} from './activity-page-ops'
import { CorrectionsView } from './corrections-view'
import { correctionWeekOptions } from './corrections-view-ops'
import { ChoiceSelect } from './settings-form-controls'
import { ReconnectingBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * League activity — §16.1 `…/leagues/[id]/activity` "Activity + Commissioner
 * Action Log" (M6 task L.E1.34; spec §13.4, §10.3; tasks-M6 TD12; PROGRESS
 * D459). The server page has already decided the viewer is a member
 * (`activity-page-gate.ts`).
 *
 * **Five tabs, one renderer each — nothing forked:**
 *  - *All*, *Adds & drops*, *Trades* — `ActivityFeed` over the feed read,
 *    paged with "Show older" (F371). Trades is the server's `topic=trades`
 *    (Q84: went through, vetoed, reversed — one line each; offers stay in
 *    the trade center). A ✸ line links to its log entry (F233(d)).
 *  - *Commissioner* — `CommishLogSection` over the §10.3 log, filterable by
 *    team and week (the week's narrow meaning said in words — F534), paged;
 *    a ✸ door opens it AT the entry, marked and scrolled to.
 *  - *Stat corrections* — L.E2.4's `CorrectionsView`, mounted as the tab
 *    (F536); its week writes back to the URL.
 *
 * The tab and its filters live in the URL (`activityHref` — one spelling), so
 * every door in the app links straight to a tab. The page joins the league
 * room ONCE: a feed event re-reads the feed and the log (every commissioner
 * verb writes its receipt and its post in one transaction — D336).
 */
export function ActivityPage({ leagueId, initial }: { leagueId: string; initial: ActivityRoute }) {
  const league = useLeague(leagueId)
  const router = useRouter()
  const queryClient = useQueryClient()
  // R1392: the tab and its filters are READ FROM THE URL on every render, never
  // held in state — Next keeps a client component mounted across a
  // search-param-only navigation, so state seeded once would ignore a ✸ link on
  // this very page (All → Commissioner) and drift on Back / Forward. `initial`
  // (the server's parse of the same URL) is only the fallback when there are no
  // search params to read (a static render).
  const searchParams = useSearchParams()
  const route = activityRouteFrom(searchParams, initial)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    invalidateCommishLog(queryClient, leagueId)
  }
  // R773's shape: the handler map is DERIVED from the feed's own predicate.
  const handlers: LeagueChannelHandlers = {}
  for (const event of LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)) handlers[event] = invalidate
  const { connection } = useLeagueChannel(leagueId, handlers, { onJoin: invalidate, onDrop: invalidate })

  // A tab or a filter is a URL change; the render above reads it back.
  const go = (next: ActivityRoute) => {
    router.replace(activityHref(leagueId, next), { scroll: false })
  }

  if (league.isPending) {
    return (
      <div className="flex flex-col gap-4" data-activity-page="loading">
        <PageHeader title={ACTIVITY_PAGE_TITLE} />
        <div className="flex flex-col gap-1.5" data-skeleton="activity-page">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 rounded-sm" />
          ))}
        </div>
      </div>
    )
  }
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading={ACTIVITY_PAGE_TITLE}
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => void league.refetch()}
        leagueId={null}
      />
    )
  }

  const data = league.data
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  const memberNames = memberNamesOf(data.members)
  const leagueTimeZone = data.settings.draft.time_zone ?? null

  return (
    <div className="flex flex-col gap-4" data-activity-page={route.tab}>
      <PageHeader
        title={ACTIVITY_PAGE_TITLE}
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>
              <Icon name="cup" size={13} />
              {data.league.name}
            </Link>
          </Button>
        }
      />
      {connection === 'reconnecting' && <ReconnectingBanner />}
      <Tabs value={route.tab} onValueChange={(value) => go({ tab: value as ActivityTab, week: null, team: null, entry: null })}>
        <TabsList aria-label={ACTIVITY_PAGE_TITLE} className="flex-wrap" data-activity-tabs>
          {ACTIVITY_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} data-tab={tab}>
              {ACTIVITY_TAB_LABELS[tab]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all" className="mt-3" data-tab-panel="all">
          <FeedTab leagueId={leagueId} tab="all" filters={{}} teamNames={teamNames} memberNames={memberNames} leagueTimeZone={leagueTimeZone} />
        </TabsContent>
        <TabsContent value="adds" className="mt-3" data-tab-panel="adds">
          <FeedTab leagueId={leagueId} tab="adds" filters={{ type: ADD_DROP_TYPES }} teamNames={teamNames} memberNames={memberNames} leagueTimeZone={leagueTimeZone} />
        </TabsContent>
        <TabsContent value="trades" className="mt-3" data-tab-panel="trades">
          <FeedTab leagueId={leagueId} tab="trades" filters={{ topic: 'trades' }} teamNames={teamNames} memberNames={memberNames} leagueTimeZone={leagueTimeZone} />
        </TabsContent>
        <TabsContent value="commissioner" className="mt-3" data-tab-panel="commissioner">
          <CommishTab leagueId={leagueId} data={data} route={route} onRoute={go} teamNames={teamNames} leagueTimeZone={leagueTimeZone} />
        </TabsContent>
        <TabsContent value="corrections" className="mt-3" data-tab-panel="corrections">
          {/* F536: L.E2.4's view, mounted — never a copy. Keyed on the week so a
              link to another week re-opens its filter there (R1369). */}
          <CorrectionsView
            key={route.week ?? 'all'}
            leagueId={leagueId}
            initialWeek={route.week}
            leagueTimeZone={leagueTimeZone}
            onWeekChange={(week) => go({ tab: 'corrections', week, team: null, entry: null })}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** One feed tab: the feed read with the tab's filter, paged (F371). */
function FeedTab({
  leagueId,
  tab,
  filters,
  teamNames,
  memberNames,
  leagueTimeZone,
}: {
  leagueId: string
  tab: 'all' | 'adds' | 'trades'
  filters: Omit<ActivityFilters, 'before' | 'beforeId'>
  teamNames: ReadonlyMap<string, string>
  memberNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
}) {
  const feed = useLeagueActivityPages(leagueId, filters)
  const items = feed.data?.pages.flatMap((page) => page.items)
  const nextFailed = feed.isFetchNextPageError
  return (
    <ActivityFeed
      leagueId={leagueId}
      title={ACTIVITY_TAB_LABELS[tab]}
      intro={TAB_INTRO_COPY[tab]}
      emptyCopy={TAB_EMPTY_COPY[tab]}
      items={items}
      pending={feed.isPending}
      // A failed NEXT page is said by "Show older" itself, not as a stale list.
      problem={feed.isError && !nextFailed ? feed.error : null}
      onRetry={() => void feed.refetch()}
      teamNames={teamNames}
      memberNames={memberNames}
      leagueTimeZone={leagueTimeZone}
      older={{
        hasMore: feed.hasNextPage,
        loading: feed.isFetchingNextPage,
        failed: nextFailed,
        onShowOlder: () => void feed.fetchNextPage(),
      }}
    />
  )
}

/** The Commissioner tab: the §10.3 log, by team and week, paged; opened at an
 *  entry when a ✸ door sent the viewer here. */
function CommishTab({
  leagueId,
  data,
  route,
  onRoute,
  teamNames,
  leagueTimeZone,
}: {
  leagueId: string
  data: LeagueDetail
  route: ActivityRoute
  onRoute: (next: ActivityRoute) => void
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
}) {
  const schedule = useSchedule(leagueId)
  const log = useCommishLog(leagueId, {
    limit: 50,
    ...(route.team ? { team_id: route.team } : {}),
    ...(route.week !== null ? { week: route.week } : {}),
    ...(route.entry ? { entry: route.entry } : {}),
  })
  const items = log.data?.pages.flatMap((page) => page.items)
  const nextFailed = log.isFetchNextPageError
  const filtered = route.team !== null || route.week !== null
  const weekOptions = correctionWeekOptions((schedule.data?.weeks ?? []).map((w) => w.week), route.week)
  const teamOptions = [
    { value: 'all', label: ALL_TEAMS_LABEL },
    ...data.teams.map((t) => ({ value: t.id, label: t.status === 'retired' ? `${t.name} (retired)` : t.name })),
  ]

  return (
    <Card data-commish-tab>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        <p className="text-[11px] font-medium text-n-3">{TAB_INTRO_COPY.commissioner}</p>
        <div className="flex flex-wrap items-center gap-2" data-commish-filters>
          <ChoiceSelect
            id="commish-log-team"
            ariaLabel="Team"
            value={route.team ?? 'all'}
            width="w-44"
            options={teamOptions}
            onValueChange={(v) => onRoute({ ...route, team: v === 'all' ? null : v, entry: null })}
          />
          <ChoiceSelect
            id="commish-log-week"
            ariaLabel="Week"
            value={route.week === null ? 'all' : String(route.week)}
            width="w-32"
            options={weekOptions}
            onValueChange={(v) => onRoute({ ...route, week: v === 'all' ? null : Number(v), entry: null })}
          />
        </div>
        {route.week !== null && (
          <p className="text-[11px] font-medium text-n-3" data-commish-week-note>
            {COMMISH_WEEK_NOTE}
          </p>
        )}
        {route.entry && (
          <div className="flex flex-wrap items-center gap-2" data-commish-entry-note>
            <p className="text-[11px] font-bold text-ink">{COMMISH_ENTRY_NOTE}</p>
            <Button variant="stroke" size="sm" onClick={() => onRoute({ ...route, entry: null })}>
              {SHOW_NEWEST_LABEL}
            </Button>
          </div>
        )}
        <CommishLogSection
          title={ACTIVITY_TAB_LABELS.commissioner}
          className="border-t-0 pt-0"
          items={items}
          pending={log.isPending}
          problem={log.isError && !nextFailed ? log.error : null}
          onRetry={() => void log.refetch()}
          hasMore={log.hasNextPage}
          memberNames={memberNamesOf(data.members)}
          teamNames={teamNames}
          leagueTimeZone={leagueTimeZone}
          emptyCopy={filtered || route.entry ? COMMISH_FILTERED_EMPTY_COPY : undefined}
          highlightId={route.entry}
          older={{
            hasMore: log.hasNextPage,
            loading: log.isFetchingNextPage,
            failed: nextFailed,
            onShowOlder: () => void log.fetchNextPage(),
          }}
        />
      </CardContent>
    </Card>
  )
}
