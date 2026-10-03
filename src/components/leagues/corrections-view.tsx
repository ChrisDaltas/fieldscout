'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { leagueCardContext } from '@/components/players/player-card-context'
import { PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useSchedule } from '@/hooks/use-schedule'
import { useStatCorrectionsLive } from '@/hooks/use-stat-corrections'

import {
  CORRECTIONS_INTRO_COPY,
  CORRECTIONS_LINK_LABEL,
  CORRECTIONS_PROBLEM_COPY,
  CORRECTIONS_SHOW_OLDER_LABEL,
  CORRECTIONS_STALE_COPY,
  CORRECTIONS_TITLE,
  MATCHUP_NOTE_PROBLEM_COPY,
  OTHER_RESULTS_LINE,
  type CorrectionNoteScope,
  correctionCard,
  correctionWeekOptions,
  correctionsHref,
  correctionsListView,
  matchupCorrectionNote,
  noteReadState,
  noteShouldFetchNextPage,
} from './corrections-view-ops'
import { TeamNameLink } from './league-cells'
import { formatInstantWithDate } from './lineup-editor-ops'
import { ChoiceSelect } from './settings-form-controls'
import { ReconnectingBanner, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'

/**
 * The league's stat corrections — M6 task L.E2.4 (spec §23.4 "League-facing
 * 'Stat Corrections' view", §16.2 `corrections-view`, §16.5.2 *Stat
 * corrections*; tasks-M6 §6 L.E2.4 read through Q81; PROGRESS D454 / D456).
 *
 * **One view.** `CorrectionsView` is the tab body — the week filter and the
 * list — mounted by the Activity page as its "Stat corrections" tab (L.E1.34,
 * F536; the page owns the membership gate, the header and the `?week=`
 * write-back; the old `/corrections` route redirects there).
 * `MatchupCorrectionNote` is the matchup page's change note over the same
 * read.
 *
 * **Data.** L.E2.3's `GET …/corrections?week=` through
 * `useStatCorrectionsLive`: only corrections that CHANGED a league score
 * (Q81 — a fix after a week is final changes nothing, so it is never
 * listed; there is no "week final" state and no commissioner door), each in
 * the record's own words. Live per F527: the scoring door's correction post
 * (same transaction as the records) refetches it on the one `league:<id>`
 * room; so do a (re)join and a return to the tab.
 *
 * **States:** loading (skeleton) · empty week (the server's own sentence —
 * never inferred) · error-with-retry · degraded (a refetch failed over
 * last-good rows: the banner + the rows) · pre-push (a database without
 * 172: the server's named sentence, never an empty list or an error) ·
 * more (`Show older` follows the server's cursor).
 */
export function CorrectionsView({
  leagueId,
  initialWeek = null,
  leagueTimeZone,
  onWeekChange,
}: {
  leagueId: string
  initialWeek?: number | null
  leagueTimeZone: string | null
  /** The host's URL write-back for the week filter (R1369); a tab host passes its own. */
  onWeekChange?: (week: number | null) => void
}) {
  const [week, setWeek] = useState<number | null>(initialWeek)
  const schedule = useSchedule(leagueId)
  const corrections = useStatCorrectionsLive(leagueId, week === null ? {} : { week })
  const pages = corrections.data?.pages
  const view = pages ? correctionsListView(pages) : null
  const problem = corrections.isError ? corrections.error : null
  const weekOptions = correctionWeekOptions((schedule.data?.weeks ?? []).map((w) => w.week), week)

  return (
    <Card data-corrections-view>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="min-w-0 flex-1">{CORRECTIONS_TITLE}</span>
          <ChoiceSelect
            id="corrections-week"
            ariaLabel="Week"
            value={week === null ? 'all' : String(week)}
            width="w-32"
            options={weekOptions}
            onValueChange={(v) => {
              const next = v === 'all' ? null : Number(v)
              setWeek(next)
              onWeekChange?.(next)
            }}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        <p className="text-[11px] font-medium text-n-3" data-corrections-intro>
          {CORRECTIONS_INTRO_COPY}
        </p>
        {corrections.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
        {problem != null && pages && <StaleDataBanner>{CORRECTIONS_STALE_COPY}</StaleDataBanner>}

        {corrections.isPending ? (
          <ListSkeleton />
        ) : problem != null && !pages ? (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-corrections-state="error">
            <p className="text-[12px] font-bold">{CORRECTIONS_PROBLEM_COPY}</p>
            <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
            <Button variant="stroke" size="sm" onClick={() => corrections.refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : view?.kind === 'unavailable' ? (
          <p className="rounded-sm border border-n-4 px-3 py-2 text-[12px] font-medium text-n-3" data-corrections-state="unavailable">
            {view.reason}
          </p>
        ) : view?.kind === 'empty' ? (
          <p className="text-[12px] font-medium text-n-3" data-corrections-state="empty">
            {view.note}
          </p>
        ) : view?.kind === 'items' ? (
          <>
            <ol className="flex flex-col divide-y divide-n-4" data-corrections-state="items">
              {view.items.map((item) => (
                <CorrectionRow key={item.id} leagueId={leagueId} card={correctionCard(item)} leagueTimeZone={leagueTimeZone} />
              ))}
            </ol>
            {view.hasMore && (
              <Button
                variant="stroke"
                size="sm"
                className="self-start"
                disabled={corrections.isFetchingNextPage}
                onClick={() => corrections.fetchNextPage()}
                data-corrections-more
              >
                {CORRECTIONS_SHOW_OLDER_LABEL}
              </Button>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CorrectionRow({
  leagueId,
  card,
  leagueTimeZone,
}: {
  leagueId: string
  card: ReturnType<typeof correctionCard>
  leagueTimeZone: string | null
}) {
  const when = formatInstantWithDate(card.recordedAt, leagueTimeZone)
  return (
    <li className="flex flex-col gap-1 py-2" data-correction={card.id} data-result-tone={card.result.tone}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {card.position && <PositionBadge position={card.position} size="sm" />}
        <PlayerLink playerId={card.playerId} name={card.playerName} context={leagueCardContext(leagueId)} className="min-w-0 text-[13px] font-bold text-ink" />
        {card.nflTeam && <span className="text-[10px] font-medium text-n-3">{card.nflTeam}</span>}
        <span className="ml-auto flex items-center gap-2 text-[10px] font-medium text-n-3">
          <span>
            Week <span className="fs-num">{card.week}</span>
          </span>
          <span className="fs-num" title={when.title ?? undefined}>
            {when.local}
          </span>
        </span>
      </div>
      <ul className="flex flex-col text-[12px] font-medium text-ink" data-correction-stats>
        {card.stats.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-n-3">
        <TeamNameLink name={card.teamName} leagueId={leagueId} teamId={card.teamId} className="font-bold text-ink" />
        <span className="fs-num" data-correction-player-points>
          {card.playerPoints}
        </span>
        <span className="fs-num" data-correction-team-score>
          {card.teamScore}
        </span>
      </p>
      {card.result.tone === 'changed' ? (
        <div className="flex flex-wrap items-center gap-2" data-correction-result="changed">
          <Badge variant="stroke-pink">Result changed</Badge>
          {card.result.lines.map((line) => (
            <span key={line} className="text-[11px] font-bold text-ink">
              {line}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] font-medium text-n-3" data-correction-result={card.result.tone}>
          {card.result.lines[0]}
        </p>
      )}
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" data-skeleton="corrections">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-sm" />
      ))}
    </div>
  )
}

/**
 * The matchup page's change note (§16.5.2: "if result flipped: matchup
 * shows change note"; the task: "when a correction changed the score or
 * result") — the week's corrections that touched this matchup's teams, in
 * the record's own sentence, with the door to the full list. Nothing while
 * the read loads or when no correction touched them; a database without
 * 172 hides it (the deploy lane: a section whose read is absent is hidden,
 * never an error); a failed read says so with a retry, never "no
 * corrections". Every page of the week is read (the server pages at 100),
 * so a matchup's correction is never missed behind the first page.
 */
export function MatchupCorrectionNote({
  leagueId,
  week,
  teamIds,
  scope = 'matchup',
}: {
  leagueId: string
  week: number
  teamIds: readonly (string | null)[]
  /** The game the host row shows (R1365), or `team` for a `total_points` week (R1368). */
  scope?: CorrectionNoteScope
}) {
  const corrections = useStatCorrectionsLive(leagueId, { week, limit: 100 })
  const flags = {
    hasData: Boolean(corrections.data),
    isError: corrections.isError,
    isFetchNextPageError: corrections.isFetchNextPageError,
    hasNextPage: corrections.hasNextPage,
    isFetchingNextPage: corrections.isFetchingNextPage,
  }
  const fetchMore = noteShouldFetchNextPage(flags)
  const { fetchNextPage } = corrections
  useEffect(() => {
    // R1366: never re-ask for a page whose last ask failed (retry: false) — the error line below offers the retry.
    if (fetchMore) void fetchNextPage()
  }, [fetchMore, fetchNextPage])

  const state = noteReadState(flags)
  if (state === 'wait') return null
  const pages = corrections.data?.pages
  if (state === 'error' || !pages) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-n-3" data-correction-note="error">
        <span>{MATCHUP_NOTE_PROBLEM_COPY}</span>
        <Button
          variant="stroke"
          size="sm"
          onClick={() => (corrections.isFetchNextPageError ? corrections.fetchNextPage() : corrections.refetch())}
        >
          <Icon name="reset" size={13} /> Retry
        </Button>
      </div>
    )
  }
  const view = correctionsListView(pages)
  if (view.kind !== 'items') return null
  const note = matchupCorrectionNote(view.items, teamIds, scope)
  if (!note) return null
  return (
    <div
      className="flex flex-col gap-1.5 rounded-sm border border-accent bg-accent-soft px-3 py-2"
      data-correction-note={note.resultChanged ? 'result' : 'score'}
    >
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
        <Icon name="repeat" size={13} />
        {note.title}
      </p>
      <ul className="flex flex-col gap-0.5 text-[11px] font-medium text-ink">
        {note.lines.map((line) => (
          <li key={line.id} className="flex flex-col">
            <span data-correction-note-line>{line.text}</span>
            {line.results.map((r) => (
              <span key={r} className="font-bold" data-correction-note-result>
                {r}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {note.otherResults.length > 0 && (
        <div className="flex flex-col gap-0.5 text-[11px] font-medium text-ink" data-correction-note-other>
          <span className="text-n-3">{OTHER_RESULTS_LINE}</span>
          {note.otherResults.map((r) => (
            <span key={r} className="font-bold">
              {r}
            </span>
          ))}
        </div>
      )}
      <Link
        href={correctionsHref(leagueId, week)}
        className="self-start text-[11px] font-bold text-accent-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        data-corrections-link
      >
        {CORRECTIONS_LINK_LABEL}
      </Link>
    </div>
  )
}
