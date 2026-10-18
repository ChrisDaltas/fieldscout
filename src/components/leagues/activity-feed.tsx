'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { leagueCardContext } from '@/components/players/player-card-context'
import { TextWithPlayers } from '@/components/players/player-link'
import { TextWithActor, TextWithUsernames, UsernameLink } from '@/components/shared/username-link'
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
  groupCommishLogLines,
  groupFeedLines,
  feedLines,
} from './activity-feed-ops'
import { SEE_ALL_ACTIVITY_LABEL, SHOW_OLDER_LABEL, commishEntryHref } from './activity-page-ops'
import { Crest, TeamNameLink } from './league-cells'
import { formatInstantWithDate } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'

/** v7's 11px semibold blue door ("See all activity", "Stat corrections"). */
const DOOR_LINK =
  'text-[11px] font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
  memberNames,
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
  /** user id → username (the league's members), so a post's actor is a door
   *  to his profile (L.E1.41). Omitted ⇒ post text is plain. */
  memberNames?: ReadonlyMap<string, string>
}) {
  const lines = items ? feedLines(items, teamNames, memberNames) : []
  // R1468: a commissioner's lineup fix — one receipt per move — reads as ONE line.
  const groups = items ? groupFeedLines(items, lines) : []
  return (
    // `id="activity"` — League Home's section anchor (the console linked
    // here before the Activity page existed — D457(7)).
    // v7 "Latest activity": a bare section — 15px title, 11px blue doors,
    // hairline rows of tile + 11px line + 10px grey time.
    <div id="activity" className="flex min-w-0 flex-col gap-2.5" data-activity-feed>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-h6 text-ink">{title}</span>
          {correctionsHref && (
            <Link
              href={correctionsHref}
              className={DOOR_LINK}
              data-corrections-link
            >
              Stat corrections
            </Link>
          )}
          {seeAllHref && (
            <Link
              href={seeAllHref}
              className={DOOR_LINK}
              data-see-all-activity
            >
              {SEE_ALL_ACTIVITY_LABEL}
            </Link>
          )}
      </div>
      <div className="flex flex-col gap-2">
        {intro && (
          <p className="text-[11px] font-medium text-n-6" data-activity-intro>
            {intro}
          </p>
        )}
        {problem != null && items && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
        {pending && !items ? (
          <div className="flex flex-col gap-1.5" data-skeleton="activity">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : problem != null && !items ? (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-negative-soft px-3.5 py-3" role="alert" data-problem>
            <p className="text-[12px] font-bold text-ink">Couldn’t load the activity feed.</p>
            <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
            <Button variant="stroke" size="sm" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : lines.length === 0 && !older?.hasMore ? (
          <p className="rounded-xl bg-surface-sunken px-3.5 py-4 text-center text-[11px] font-medium text-n-6" data-empty="activity">
            {emptyCopy}
          </p>
        ) : (
          <ol className="flex flex-col" data-feed-items>
            {groups.map(({ line, entries }) => {
              const when = line.createdAt ? formatInstantWithDate(line.createdAt, leagueTimeZone) : null
              return (
                <li key={line.id} className="flex gap-[9px] border-t border-n-4 px-[3px] py-2.5" data-feed-item={line.kind} data-feed-group={entries.length > 1 ? entries.length : undefined}>
                  {/* v7 row tile: the franchise's rounded-square crest, else a
                      round glyph for a league-wide post. */}
                  {line.team ? (
                    <Crest name={line.team} src={null} className="mt-px h-5 w-5 rounded-[6px]" fallbackClassName="text-[8px]" />
                  ) : (
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-control text-n-3">
                      <Icon name={line.commissioner ? 'setup' : 'notification'} size={10} />
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {line.commissioner &&
                        (line.commishActionId ? (
                          // F233(d): the ✸ line's door to its log entry.
                          <Link
                            href={commishEntryHref(leagueId, line.commishActionId)}
                            className="shrink-0 rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                        <span className="shrink-0 text-[11px] font-semibold text-ink">
                          <TeamNameLink name={line.team} leagueId={leagueId} teamId={line.teamId} />
                        </span>
                      )}
                      {/* `data-feed-text` (R940): the line's TEXT alone, so a spec can assert exact
                          equality. The <li> also renders a badge and a timestamp, so an assertion on
                          the item could only ever be containment — and containment passes against a
                          regression that wraps or prefixes the message. */}
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-n-2" data-feed-text>
                        {/* L.E1.41: a post's actor — named in its text — is a door to his profile. */}
                        {line.players && line.players.length > 0 ? (
                          // League UX batch 2: every player the line names opens his card.
                          <TextWithPlayers text={line.text} players={line.players} context={leagueCardContext(leagueId)} />
                        ) : (
                          <TextWithActor text={line.text} actor={line.actorUsername} />
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-medium text-n-6">
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
                    {entries.length > 1 && (
                      <RunEntries
                        entries={entries.map((e) => ({ id: e.id, text: e.text, createdAt: e.createdAt, href: e.commishActionId ? commishEntryHref(leagueId, e.commishActionId) : null }))}
                        leagueTimeZone={leagueTimeZone}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {older && items && <ShowOlder {...older} />}
        {commishLog && <CommishLogSection {...commishLog} teamNames={teamNames} leagueTimeZone={leagueTimeZone} />}
      </div>
    </div>
  )
}

/** R1468: the receipts one grouped line stands for, newest first — every one
 *  kept and shown (the grouping is display only). */
function RunEntries({
  entries,
  leagueTimeZone,
  open = false,
  highlightId = null,
}: {
  entries: ReadonlyArray<{ id: string; text: string; createdAt: string | null; href: string | null }>
  leagueTimeZone: string | null
  open?: boolean
  highlightId?: string | null
}) {
  return (
    <details className="text-[11px] font-medium text-n-6" open={open || undefined} data-run-entries>
      <summary className="cursor-pointer text-[10px] font-semibold text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        Show each change (<span className="fs-num">{entries.length}</span>)
      </summary>
      <ol className="mt-1 flex flex-col gap-0.5 border-l border-n-4 pl-2">
        {entries.map((e) => {
          const when = e.createdAt ? formatInstantWithDate(e.createdAt, leagueTimeZone) : null
          const body = (
            <>
              <span className="text-n-2">{e.text}</span>
              {when && (
                <span className="fs-num ml-2" title={when.title ?? undefined}>
                  {when.local}
                </span>
              )}
            </>
          )
          return (
            <li key={e.id} className={cn(e.id === highlightId && 'rounded bg-accent-soft px-1')} data-run-entry={e.id}>
              {e.href ? (
                <Link href={e.href} className="underline decoration-transparent hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

/** "Show older" — offered only while the server says there is more; a failed
 *  next page is said, with the same button to try again (never a silent end). */
function ShowOlder({ hasMore, loading, failed, onShowOlder }: ShowOlderProps) {
  if (!hasMore) return null
  return (
    <div className="flex flex-col items-start gap-1" data-show-older>
      {failed && (
        <p className="text-[11px] font-semibold text-negative-strong" role="alert" data-show-older-failed>
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
  titleInCardHeader = false,
}: CommishLogSectionProps & {
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  /** The section's heading (League Home: "Commissioner actions"). */
  title?: string
  emptyCopy?: string
  highlightId?: string | null
  older?: ShowOlderProps
  className?: string
  /** The host card's header already shows the title — keep it for screen
   *  readers only, so it never reads twice. */
  titleInCardHeader?: boolean
}) {
  const lines = items ? commishLogLines(items, teamNames, memberNames) : []
  // R1468: a lineup fix (one receipt per move) reads as ONE line that opens to each receipt.
  const groups = items ? groupCommishLogLines(items, lines) : []
  const highlighted = useRef<HTMLLIElement | null>(null)
  const highlightShown = highlightId !== null && lines.some((line) => line.id === highlightId)
  useEffect(() => {
    if (highlightShown) highlighted.current?.scrollIntoView?.({ block: 'center' })
  }, [highlightShown])
  return (
    <section className={cn('flex flex-col gap-2 border-t border-n-4 pt-3', className)} aria-label={title} data-commish-log>
      <h3 className={cn('text-[13px] font-bold tracking-[-0.01em] text-ink', titleInCardHeader && 'sr-only')}>{title}</h3>
      {problem != null && items && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
      {pending && !items ? (
        <div className="flex flex-col gap-1.5" data-skeleton="commish-log">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-7 rounded-md" />
          ))}
        </div>
      ) : problem != null && !items ? (
        // A FAILED read is never the empty state (CLAUDE.md).
        <div className="flex flex-col items-start gap-2 rounded-xl bg-negative-soft px-3.5 py-3" role="alert" data-problem="commish-log">
          <p className="text-[12px] font-bold text-ink">{COMMISH_LOG_PROBLEM_COPY}</p>
          <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
          <Button variant="stroke" size="sm" onClick={onRetry}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </div>
      ) : lines.length === 0 ? (
        <p className="text-[11px] font-medium text-n-6" data-empty="commish-log">
          {emptyCopy}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-n-4" data-commish-log-items>
          {groups.map(({ line, entries }) => {
            const when = formatInstantWithDate(line.createdAt, leagueTimeZone)
            const isHighlighted = entries.some((e) => e.id === highlightId)
            return (
              <li
                key={line.id}
                ref={isHighlighted ? highlighted : undefined}
                // The opened entry is a RESTING state — a fill, never a shadow (CLAUDE.md).
                className={cn('flex flex-col gap-1 py-2.5', isHighlighted && 'rounded-md bg-accent-soft px-2')}
                data-commish-log-item={line.id}
                data-commish-log-group={entries.length > 1 ? entries.length : undefined}
                data-highlighted={isHighlighted ? '' : undefined}
                aria-current={isHighlighted ? 'true' : undefined}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Badge variant="stroke-purple" className="shrink-0">
                    {COMMISSIONER_LABEL}
                  </Badge>
                  <span className="min-w-0 flex-1 text-[11px] font-medium leading-[1.45] text-n-2" data-commish-log-text>
                    {/* L.E1.41: the commissioner, and every member the sentence names, is a door to his profile. */}
                    {line.actorUsername ? (
                      <UsernameLink username={line.actorUsername} at={false} className="font-bold text-ink" />
                    ) : (
                      <span className="font-bold text-ink">{line.actor}</span>
                    )}{' '}
                    <TextWithUsernames
                      marked={line.marked}
                      // F563: the players the sentence names are doors too (the league shell's ambient card context).
                      renderText={(t) => <TextWithPlayers text={t} players={line.players} />}
                    />
                    {/* A NULL reason is ABSENT — no clause, no empty quote (§10.3). */}
                    {line.reason !== null && <span data-commish-log-reason>{` — reason: “${line.reason}”`}</span>}
                  </span>
                </div>
                <span className="fs-num text-[10px] font-medium text-n-6" title={when.title ?? undefined}>
                  {when.local}
                </span>
                {entries.length > 1 && (
                  <RunEntries
                    entries={entries.map((e) => ({ id: e.id, text: e.reason ? `${e.text} — reason: “${e.reason}”` : e.text, createdAt: e.createdAt, href: null }))}
                    leagueTimeZone={leagueTimeZone}
                    open={isHighlighted && line.id !== highlightId}
                    highlightId={highlightId}
                  />
                )}
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
            className={cn('self-start', DOOR_LINK)}
            data-commish-log-more
          >
            Showing the latest <span className="fs-num">{lines.length}</span> — see all commissioner actions
          </Link>
        ) : (
          <p className="text-[10px] font-medium text-n-6" data-commish-log-more>
            Showing the latest <span className="fs-num">{lines.length}</span> — older actions are kept in the log.
          </p>
        ))
      )}
    </section>
  )
}
