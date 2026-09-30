'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
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
import { SEE_ALL_ACTIVITY_LABEL, SHOW_OLDER_LABEL, commishEntryHref } from './activity-page-ops'
import { TeamNameLink } from './league-cells'
import { formatInstantWithDate } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'

/** "Show older" under a paged list (the Activity page — F371). */
export interface ShowOlderProps {
  /** The server says there is more (`has_more`). */
  hasMore: boolean
  /** A next page is being read. */
  loading: boolean
  /** The last next-page read failed — said, with the same button to retry. */
  failed: boolean
  onShowOlder: () => void
}

/**
 * The unified activity feed — §16.2 `activity-feed` ("unified feed w/
 * commissioner action treatment"), §13.4, §16.5.1's `in_season` row (M4
 * task L.D5.4; PROGRESS D310(5), D324). Presentational: the host owns the
 * read and hands the items in; this renders `transactions` rows and the
 * league room's D97 system posts as one list. The "✸ commissioner" label is
 * §13.4's treatment — worn by a system post only when an actor wrote it; a
 * NULL-actor post (a week worker's notice) wears a plain "system" chip
 * (R895).
 *
 * **M6 L.E1.34 (F233(d), F371, F463; PROGRESS D459).** A ✸ line whose act
 * left a §10.3 receipt links to that entry (the Activity page's Commissioner
 * tab, opened at it); a commissioner's act that wrote a feed row AND a post
 * shows once (`feedLines`). The same component is League Home's short list
 * (with "See all activity" — `seeAllHref`) and each feed tab of the Activity
 * page (with its own title / intro / empty copy and "Show older" — `older`).
 *
 * **COMMISSIONER ACTIONS (M6A L.E1.13 — Q66, spec v2.16.41 §10 / §10.3).**
 * League Home hands in the §10.3 log as `commishLog`, rendered as its own
 * titled list inside this card — the same component, not a second feed
 * (CLAUDE.md: no near-duplicates), with its OWN four states. A row is a
 * CLAIM, not proof a verb ran (C70). A NULL reason renders as ABSENT.
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
  correctionsHref,
  seeAllHref,
  title = FEED_TITLE,
  intro,
  emptyCopy = FEED_EMPTY_COPY,
  older,
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
  /** The door to the league's stat corrections (the Activity page's tab —
   *  L.E1.34 / F536). Omitted ⇒ no link. */
  correctionsHref?: string
  /** League Home's door to the whole feed (L.E1.34, F371). Omitted ⇒ no link. */
  seeAllHref?: string
  title?: string
  /** One sentence above the list saying what it holds (an Activity tab). */
  intro?: string
  emptyCopy?: string
  /** "Show older" (the Activity page). Omitted ⇒ no control. */
  older?: ShowOlderProps
}) {
  const lines = items ? feedLines(items, teamNames) : []
  return (
    // `id="activity"` — League Home's section anchor (the console linked
    // here before the Activity page existed — D457(7)).
    <Card id="activity" data-activity-feed>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="min-w-0 flex-1">{title}</span>
          {correctionsHref && (
            <Link
              href={correctionsHref}
              className="text-[11px] font-bold text-accent-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              data-corrections-link
            >
              Stat corrections
            </Link>
          )}
          {seeAllHref && (
            <Link
              href={seeAllHref}
              className="text-[11px] font-bold text-accent-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              data-see-all-activity
            >
              {SEE_ALL_ACTIVITY_LABEL}
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-2">
        {intro && (
          <p className="text-[11px] font-medium text-n-3" data-activity-intro>
            {intro}
          </p>
        )}
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
        ) : lines.length === 0 && !older?.hasMore ? (
          <p className="text-[12px] font-medium text-n-3" data-empty="activity">
            {emptyCopy}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4" data-feed-items>
            {lines.map((line) => {
              const when = line.createdAt ? formatInstantWithDate(line.createdAt, leagueTimeZone) : null
              return (
                <li key={line.id} className="flex flex-col gap-0.5 py-1.5" data-feed-item={line.kind}>
                  <div className="flex min-w-0 items-center gap-2">
                    {line.commissioner &&
                      (line.commishActionId ? (
                        // F233(d): the ✸ line's door to its log entry.
                        <Link
                          href={commishEntryHref(leagueId, line.commishActionId)}
                          className="shrink-0 rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                          title="See this in the commissioner’s log"
                          data-commissioner-entry={line.commishActionId}
                        >
                          <Badge variant="stroke-purple" className="hover:bg-accent-soft" data-commissioner>
                            {COMMISSIONER_LABEL}
                          </Badge>
                        </Link>
                      ) : (
                        <Badge variant="stroke-purple" className="shrink-0" data-commissioner>
                          {COMMISSIONER_LABEL}
                        </Badge>
                      ))}
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
        {older && items && <ShowOlder {...older} />}
        {commishLog && <CommishLogSection {...commishLog} teamNames={teamNames} leagueTimeZone={leagueTimeZone} />}
      </CardContent>
    </Card>
  )
}

/** "Show older" — offered only while the server says there is more; a failed
 *  next page is said, with the same button to try again (never a silent end). */
function ShowOlder({ hasMore, loading, failed, onShowOlder }: ShowOlderProps) {
  if (!hasMore) return null
  return (
    <div className="flex flex-col items-start gap-1" data-show-older>
      {failed && (
        <p className="text-[11px] font-bold text-negative" role="alert" data-show-older-failed>
          Couldn’t load older items.
        </p>
      )}
      <Button variant="stroke" size="sm" onClick={onShowOlder} disabled={loading}>
        {loading ? 'Loading…' : SHOW_OLDER_LABEL}
      </Button>
    </div>
  )
}

export interface CommishLogSectionProps {
  items: readonly CommishLogItem[] | undefined
  pending: boolean
  problem: unknown
  onRetry: () => void
  /** The log holds more rows than this page shows. */
  hasMore: boolean
  /** League Home: where "see all" goes when the log holds more (L.E1.34 —
   *  the Activity page's Commissioner tab). Omitted ⇒ the plain note. */
  moreHref?: string
  /** user id → username, so a membership receipt names the member. */
  memberNames?: ReadonlyMap<string, string>
}

/**
 * The §10.3 log's list with its four states — League Home's section, the
 * Commissioner Console's "Recent actions" (L.E1.33) and the Activity page's
 * Commissioner tab (L.E1.34): one renderer (TD12). The tab passes `older`
 * (F371's "Show older" on the cursor) and `highlightId` (the entry a ✸ door
 * opened — F233(d)), which is marked with a resting fill and scrolled to.
 */
export function CommishLogSection({
  items,
  pending,
  problem,
  onRetry,
  hasMore,
  moreHref,
  memberNames,
  teamNames,
  leagueTimeZone,
  title = COMMISH_LOG_TITLE,
  emptyCopy = COMMISH_LOG_EMPTY_COPY,
  highlightId = null,
  older,
  className,
}: CommishLogSectionProps & {
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  /** The section's heading (League Home: "Commissioner actions"). */
  title?: string
  emptyCopy?: string
  highlightId?: string | null
  older?: ShowOlderProps
  className?: string
}) {
  const lines = items ? commishLogLines(items, teamNames, memberNames) : []
  const highlighted = useRef<HTMLLIElement | null>(null)
  const highlightShown = highlightId !== null && lines.some((line) => line.id === highlightId)
  useEffect(() => {
    if (highlightShown) highlighted.current?.scrollIntoView?.({ block: 'center' })
  }, [highlightShown])
  return (
    <section className={cn('flex flex-col gap-2 border-t border-ink pt-2', className)} aria-label={title} data-commish-log>
      <h3 className="text-[12px] font-bold text-ink">{title}</h3>
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
          {emptyCopy}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-n-4" data-commish-log-items>
          {lines.map((line) => {
            const when = formatInstantWithDate(line.createdAt, leagueTimeZone)
            const isHighlighted = line.id === highlightId
            return (
              <li
                key={line.id}
                ref={isHighlighted ? highlighted : undefined}
                // The opened entry is a RESTING state — a fill, never a shadow (CLAUDE.md).
                className={cn('flex flex-col gap-0.5 py-1.5', isHighlighted && 'rounded-sm bg-accent-soft px-1.5')}
                data-commish-log-item={line.id}
                data-highlighted={isHighlighted ? '' : undefined}
                aria-current={isHighlighted ? 'true' : undefined}
              >
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
      {older && items ? (
        <ShowOlder {...older} />
      ) : (
        hasMore &&
        lines.length > 0 &&
        (moreHref ? (
          <Link
            href={moreHref}
            className="self-start text-[11px] font-bold text-accent-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            data-commish-log-more
          >
            Showing the latest <span className="fs-num">{lines.length}</span> — see all commissioner actions
          </Link>
        ) : (
          <p className="text-[10px] font-medium text-n-3" data-commish-log-more>
            Showing the latest <span className="fs-num">{lines.length}</span> — older actions are kept in the log.
          </p>
        ))
      )}
    </section>
  )
}
