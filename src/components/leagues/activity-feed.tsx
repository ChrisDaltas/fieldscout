'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'

import { COMMISSIONER_LABEL, FEED_EMPTY_COPY, FEED_TITLE, SYSTEM_LABEL, feedLines } from './activity-feed-ops'
import { formatInstantWithDate } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'

/**
 * The unified activity feed — §16.2 `activity-feed` ("unified feed w/
 * commissioner action treatment"), §13.4, §16.5.1's `in_season` row (M4
 * task L.D5.4; PROGRESS D310(5), D324). Presentational: the host owns the
 * read (`useLeagueActivityFeed` — L.D4.2's route + the ONE `league:<id>`
 * room, refetch-on-event) and hands the items in; this renders L.D4.2's
 * M4 slice — `transactions` rows and the league room's D97 system posts —
 * as one list. The "✸ commissioner" label is §13.4's treatment — worn by a
 * system post only when an actor wrote it; a NULL-actor post (a week
 * worker's notice) wears a plain "system" chip (R895); the link to
 * the audit entry waits for `commissioner_actions` (a later milestone's).
 *
 * States (§16.5.4): skeleton · empty (designed copy) · error-with-retry ·
 * degraded (the stale banner over last-good items). Instants are STORED
 * values formatted viewer-local with the league zone on hover (§16.4).
 */
export function ActivityFeed({
  items,
  pending,
  problem,
  onRetry,
  teamNames,
  leagueTimeZone,
}: {
  items: readonly ActivityItem[] | undefined
  pending: boolean
  problem: unknown
  onRetry: () => void
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
}) {
  const lines = items ? feedLines(items, teamNames) : []
  return (
    <Card data-activity-feed>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">{FEED_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-2">
        {problem != null && items && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
        {pending && !items ? (
          <div className="flex flex-col gap-1.5" data-skeleton="activity">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-6 rounded-sm" />
            ))}
          </div>
        ) : problem != null && !items ? (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-problem>
            <p className="text-[12px] font-bold">Couldn’t load the activity feed.</p>
            <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
            <Button variant="stroke" size="sm" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : lines.length === 0 ? (
          <p className="text-[12px] font-medium text-n-3" data-empty="activity">
            {FEED_EMPTY_COPY}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4" data-feed-items>
            {lines.map((line) => {
              const when = line.createdAt ? formatInstantWithDate(line.createdAt, leagueTimeZone) : null
              return (
                <li key={line.id} className="flex flex-col gap-0.5 py-1.5" data-feed-item={line.kind}>
                  <div className="flex min-w-0 items-center gap-2">
                    {line.commissioner && (
                      <Badge variant="stroke-purple" className="shrink-0" data-commissioner>
                        {COMMISSIONER_LABEL}
                      </Badge>
                    )}
                    {line.kind === 'system' && !line.commissioner && (
                      <Badge variant="stroke" className="shrink-0" data-system>
                        {SYSTEM_LABEL}
                      </Badge>
                    )}
                    {line.team && <span className="shrink-0 text-[12px] font-bold text-ink">{line.team}</span>}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{line.text}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-medium text-n-3">
                    {line.week !== null && (
                      <span>
                        Week <span className="fs-num">{line.week}</span>
                      </span>
                    )}
                    {when && (
                      <span className="fs-num" title={when.title ?? undefined}>
                        {when.local}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
