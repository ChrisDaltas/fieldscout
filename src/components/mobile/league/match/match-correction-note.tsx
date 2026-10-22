'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import {
  CORRECTIONS_LINK_LABEL,
  MATCHUP_NOTE_PROBLEM_COPY,
  OTHER_RESULTS_LINE,
  correctionsHref,
  correctionsListView,
  matchupCorrectionNote,
  noteReadState,
  noteShouldFetchNextPage,
  type CorrectionNoteScope,
} from '@/components/leagues/corrections-view-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { useStatCorrectionsLive } from '@/hooks/use-stat-corrections'

/**
 * The stat-correction note on the mobile Match tab — the desktop
 * `MatchupCorrectionNote` (§16.5.2 "if result flipped: matchup shows change
 * note") in the FieldScout Mobile language (app-only Match content: restyled,
 * never dropped).
 *
 * Same read and same rules: every page of the week's corrections is read
 * before anything is said (R1366 — the next page is asked for only while
 * none is in flight and the last ask did not fail); a failed page is said
 * with a retry, never shown as a partial note or as "no corrections"; the
 * title claims "this matchup's result" only when THIS game flipped (R1365).
 * Renders nothing while waiting or when no correction touched these teams.
 */
export function MobileCorrectionNote({
  leagueId,
  week,
  teamIds,
  scope,
}: {
  leagueId: string
  week: number
  teamIds: readonly (string | null)[]
  scope: CorrectionNoteScope
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
    if (fetchMore) void fetchNextPage()
  }, [fetchMore, fetchNextPage])

  const state = noteReadState(flags)
  if (state === 'wait') return null
  const pages = corrections.data?.pages
  if (state === 'error' || !pages) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 px-1 pt-3 text-[11px] font-medium text-m-t3" data-correction-note="error">
        <span className="min-w-0">{MATCHUP_NOTE_PROBLEM_COPY}</span>
        <button
          type="button"
          onClick={() => void (corrections.isFetchNextPageError ? corrections.fetchNextPage() : corrections.refetch())}
          className="flex-none text-[13px] font-semibold text-accent"
        >
          Try again
        </button>
      </div>
    )
  }
  const view = correctionsListView(pages)
  if (view.kind !== 'items') return null
  const note = matchupCorrectionNote(view.items, teamIds, scope)
  if (!note) return null
  return (
    <div className="pt-3">
      <div className="flex flex-col gap-1.5 rounded-[14px] bg-m-b1 px-3 py-2.5" data-correction-note={note.resultChanged ? 'result' : 'score'}>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-m-t1">
          <MIcon name="corrections" size={14} stroke={1.6} />
          {note.title}
        </p>
        <ul className="flex flex-col gap-1 text-[12px] font-medium leading-[1.4] text-m-t1">
          {note.lines.map((line) => (
            <li key={line.id} className="flex flex-col">
              <span data-correction-note-line>{line.text}</span>
              {line.results.map((r) => (
                <span key={r} className="font-semibold" data-correction-note-result>
                  {r}
                </span>
              ))}
            </li>
          ))}
        </ul>
        {note.otherResults.length > 0 && (
          <div className="flex flex-col gap-0.5 text-[12px] font-medium leading-[1.4] text-m-t1" data-correction-note-other>
            <span className="text-m-t3">{OTHER_RESULTS_LINE}</span>
            {note.otherResults.map((r) => (
              <span key={r} className="font-semibold">
                {r}
              </span>
            ))}
          </div>
        )}
        <Link href={correctionsHref(leagueId, week)} className="self-start py-1 text-[13px] font-semibold text-accent" data-corrections-link>
          {CORRECTIONS_LINK_LABEL}
        </Link>
      </div>
    </div>
  )
}
