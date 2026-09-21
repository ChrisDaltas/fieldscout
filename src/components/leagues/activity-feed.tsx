'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

import {
  COMMISH_LOG_EMPTY_COPY,
  COMMISH_LOG_PROBLEM_COPY,
  COMMISH_LOG_TITLE,
  COMMISSIONER_LABEL,
  FEED_EMPTY_COPY,
  FEED_TITLE,
  SYSTEM_LABEL,
  commishLogLines,
  feedLines,
} from './activity-feed-ops'
import { TeamNameLink } from './league-cells'
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
 * worker's notice) wears a plain "system" chip (R895).
 *
 * **COMMISSIONER ACTIONS (M6A L.E1.13 — Q66, spec v2.16.41 §10 / §10.3).**
 * Chris's ruling replaced the required reason with a required DISPLAY:
 * every commissioner action is shown in League Home's activity section. The
 * host hands in the §10.3 log (`useCommishLog` → `GET /commish/log`, any
 * member reads it) as `commishLog`, and it renders as its own titled list
 * inside this card — the same component, not a second feed (CLAUDE.md: no
 * near-duplicates). It has its OWN four states: a failed log read is an
 * error-with-retry and NEVER the "no commissioner actions yet" copy. A row
 * is a CLAIM, not proof a verb ran (C70) — nothing here says "applied". A
 * NULL reason renders as ABSENT. Omit the prop and the card is L.D5.4's.
 *
 * States (§16.5.4): skeleton · empty (designed copy) · error-with-retry ·
 * degraded (the stale banner over last-good items). Instants are STORED
 * values formatted viewer-local with the league zone on hover (§16.4).
 */
export function ActivityFeed({
  leagueId,
  items,
  pending,
  problem,
  onRetry,
  teamNames,
  leagueTimeZone,
  commishLog,
}: {
  leagueId: string
  items: readonly ActivityItem[] | undefined
  pending: boolean
  problem: unknown
  onRetry: () => void
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  /** The §10.3 commissioner log (Q66). Omitted ⇒ the section is not mounted. */
  commishLog?: CommishLogSectionProps
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
                    {/* Text-only door: the name stays `shrink-0` beside the
                        truncating message, so the link adds no width. */}
                    {line.team && (
                      <span className="shrink-0 text-[12px] font-bold text-ink">
                        <TeamNameLink name={line.team} leagueId={leagueId} teamId={line.teamId} />
                      </span>
                    )}
                    {/* `data-feed-text` (R940): the line's TEXT alone, so a spec can assert exact
                        equality. The <li> also renders a badge and a timestamp, so an assertion on
                        the item could only ever be containment — and containment passes against a
                        regression that wraps or prefixes the message. */}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" data-feed-text>
                      {line.text}
                    </span>
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
        {commishLog && <CommishLogSection {...commishLog} teamNames={teamNames} leagueTimeZone={leagueTimeZone} />}
      </CardContent>
    </Card>
  )
}

export interface CommishLogSectionProps {
  items: readonly CommishLogItem[] | undefined
  pending: boolean
  problem: unknown
  onRetry: () => void
  /** The log holds more rows than this page shows. */
  hasMore: boolean
}

function CommishLogSection({
  items,
  pending,
  problem,
  onRetry,
  hasMore,
  teamNames,
  leagueTimeZone,
}: CommishLogSectionProps & { teamNames: ReadonlyMap<string, string>; leagueTimeZone: string | null }) {
  const lines = items ? commishLogLines(items, teamNames) : []
  return (
    <section className="flex flex-col gap-2 border-t border-ink pt-2" aria-label={COMMISH_LOG_TITLE} data-commish-log>
      <h3 className="text-[12px] font-bold text-ink">{COMMISH_LOG_TITLE}</h3>
      {problem != null && items && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
      {pending && !items ? (
        <div className="flex flex-col gap-1.5" data-skeleton="commish-log">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 rounded-sm" />
          ))}
        </div>
      ) : problem != null && !items ? (
        // A FAILED read is never the empty state (CLAUDE.md).
        <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-problem="commish-log">
          <p className="text-[12px] font-bold">{COMMISH_LOG_PROBLEM_COPY}</p>
          <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
          <Button variant="stroke" size="sm" onClick={onRetry}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </div>
      ) : lines.length === 0 ? (
        <p className="text-[12px] font-medium text-n-3" data-empty="commish-log">
          {COMMISH_LOG_EMPTY_COPY}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-n-4" data-commish-log-items>
          {lines.map((line) => {
            const when = formatInstantWithDate(line.createdAt, leagueTimeZone)
            return (
              <li key={line.id} className="flex flex-col gap-0.5 py-1.5" data-commish-log-item={line.id}>
                <div className="flex min-w-0 items-start gap-2">
                  <Badge variant="stroke-purple" className="shrink-0">
                    {COMMISSIONER_LABEL}
                  </Badge>
                  <span className="min-w-0 flex-1 text-[12px] font-medium text-ink" data-commish-log-text>
                    <span className="font-bold">{line.actor}</span> {line.text}
                    {/* A NULL reason is ABSENT — no clause, no empty quote (§10.3). */}
                    {line.reason !== null && <span data-commish-log-reason>{` — reason: “${line.reason}”`}</span>}
                  </span>
                </div>
                <span className="fs-num text-[10px] font-medium text-n-3" title={when.title ?? undefined}>
                  {when.local}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {hasMore && lines.length > 0 && (
        <p className="text-[10px] font-medium text-n-3" data-commish-log-more>
          Showing the latest <span className="fs-num">{lines.length}</span> — older actions are kept in the log.
        </p>
      )}
    </section>
  )
}
