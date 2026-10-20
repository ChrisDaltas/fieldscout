'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { parseDraftOrder } from '@/components/draft/draft-board-ops'
import { recapVariant } from '@/components/draft/draft-recap-ops'
import { mockIdentityLabel } from '@/components/draft/mock-launcher-ops'
import { PRACTICE_HOME_HREF } from '@/components/draft/room-scope'
import { DraftResultsBody, RowsSkeleton } from '@/components/mobile/league/league/draft-results-screen'
import { MOCK_LINE } from '@/components/mobile/league/league/draft-results-ops'
import { CenterNote, PillButton } from '@/components/mobile/lists/lists-parts'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MNotice } from '@/components/mobile/ui/m-form'
import { MobileScreen, MPageBar, MPageBarAction } from '@/components/mobile/ui/mobile-header'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAuth } from '@/hooks/use-auth'
import { useDraft, type DraftPickSummary } from '@/hooks/use-draft'
import { useDraftSeatNames } from '@/hooks/use-draft-seats'
import { useDeleteMockDraft } from '@/hooks/use-mock-drafts'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'
import type { Draft } from '@/types/database'

import { MOCK_REPORT_COPY, MOCK_REPORT_PARENT, mockFinishedLabel, mockReportStats, seatsMissingLine } from './mocks-ops'

/**
 * The mock draft report on the phone (`/app/mocks/[id]/report`, gap list §4
 * item 110) — the same report as desktop's (`MockDraftReport`): every
 * player from a finished practice draft, the team that took him and his
 * cost (an auction's price, or a snake / linear draft's round and pick), on
 * the same reads (`useDraft` → the draft and its picks, `useDraftSeatNames`
 * → the seats' names). Desktop is unchanged.
 *
 * The handoff draws no report; it is League › Draft results (m-community
 * G3) over a practice draft, which is what the report is:
 *  - the G-page bar (blue back, "Mock draft report"); Back goes to where
 *    you came from, else the practice home (never a league — F119). The
 *    launcher's Delete sits at the bar's end as a red word, and asks first
 *    in a sheet (desktop's words; "Keep it" first); a delete lands on the
 *    practice home, as desktop's does;
 *  - what the run was ("Snake · 8 teams", "Finished Oct 12") over
 *    desktop's two totals tiles (Picks · Rounds, or Buys · Spent);
 *  - Draft results' list (`DraftResultsBody`, shared): By round with round
 *    chips (an auction: All buys, in nomination order, priced), or By team
 *    — your seat first, and on an auction what each team spent and its
 *    biggest buy. Your seat's picks are in blue; tapping a pick opens the
 *    player's card.
 * One honest empty state for every "no report" (an id that isn't yours, a
 * real draft's, one still running — never telling them apart), a failed
 * read says so with Try again, and so does a failed read of the team names
 * (never a list of "Team" rows that looks complete).
 */
export function MobileMockReport({ mockId }: { mockId: string }) {
  const { user } = useAuth()
  const room = useDraft(mockId)
  const draft = room.data?.draft ?? null
  const order = useMemo(() => parseDraftOrder(draft?.draft_order), [draft?.draft_order])
  const seats = useDraftSeatNames(order)

  if (room.isPending) {
    return (
      <ReportFrame>
        <ReportSkeleton />
      </ReportFrame>
    )
  }
  if (room.isError) {
    return (
      <ReportFrame>
        <CenterNote title={MOCK_REPORT_COPY.loadFailed} body={room.error.message} action={<PillButton onClick={() => void room.refetch()}>Try again</PillButton>} />
      </ReportFrame>
    )
  }
  if (!draft || !draft.is_mock || draft.status !== 'complete') return <MobileMockReportMissing />

  return (
    <ReportBody
      draft={draft}
      picks={room.data?.picks ?? []}
      order={order}
      seats={seats}
      userId={user?.id ?? null}
    />
  )
}

/** The bar and screen every report state draws in. */
function ReportFrame({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  const goBack = useGoBack()
  return (
    <MobileScreen header={<MPageBar title={MOCK_REPORT_COPY.title} onBack={() => goBack(MOCK_REPORT_PARENT)} action={action} />} className="leading-[normal]">
      {children}
    </MobileScreen>
  )
}

/**
 * The one no-leak empty state (unknown · someone else's · unfinished · not
 * a mock), desktop's words. Exported because the ROUTE draws it too, when
 * its own launcher-scoped lookup already found nothing.
 */
export function MobileMockReportMissing() {
  const router = useRouter()
  return (
    <ReportFrame>
      <div data-mock-report="missing">
        <CenterNote
          title={MOCK_REPORT_COPY.missingTitle}
          body={MOCK_REPORT_COPY.missingBody}
          action={<PillButton onClick={() => router.push(PRACTICE_HOME_HREF)}>{MOCK_REPORT_COPY.backToMocks}</PillButton>}
          className="py-16"
        />
      </div>
    </ReportFrame>
  )
}

function ReportBody({
  draft,
  picks,
  order,
  seats,
  userId,
}: {
  draft: Draft
  picks: DraftPickSummary[]
  order: string[]
  seats: ReturnType<typeof useDraftSeatNames>
  userId: string | null
}) {
  const [confirming, setConfirming] = useState(false)
  const variant = recapVariant(draft, userId, null)
  const canDelete = variant.kind === 'mock' && variant.canDelete
  const auction = draft.draft_type === 'auction'
  const { count, stats } = useMemo(() => mockReportStats(draft, picks, order.length), [draft, picks, order.length])
  const missing = seatsMissingLine(seats.data?.missing ?? 0, order.length)
  // No seats to name (a board with no order) has nothing to wait for.
  const namesPending = order.length > 0 && seats.isPending

  let list: React.ReactNode
  if (count === 0) {
    // Finished with nothing taken — a practice run ended early.
    list = <CenterNote title={auction ? MOCK_REPORT_COPY.noBuys : MOCK_REPORT_COPY.noPicks} className="py-10" />
  } else if (namesPending) {
    list = (
      <div className="px-4 pt-3">
        <RowsSkeleton />
      </div>
    )
  } else if (seats.isError) {
    list = (
      <div className="px-4 pt-3">
        <MNotice tone="error" action={{ label: 'Try again', onClick: () => void seats.refetch() }}>
          Couldn’t load the team names.
        </MNotice>
      </div>
    )
  } else {
    list = (
      <DraftResultsBody
        // A practice draft has no league to open a player in (F119): his
        // card opens on its own.
        leagueId={null}
        teamNameById={seats.data?.namesById ?? new Map()}
        myMemberTeamId={null}
        // A league mock's note says it never touched the league; a
        // standalone one has no league to mention.
        note={draft.league_id !== null ? MOCK_LINE : null}
        draft={draft}
        picks={picks}
        userId={userId}
      />
    )
  }

  return (
    <ReportFrame
      action={
        canDelete ? (
          <MPageBarAction tone="danger" onClick={() => setConfirming(true)} data-report-delete>
            Delete
          </MPageBarAction>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-4 pt-3" data-mock-report={draft.id}>
        <div className="flex flex-col gap-0.5 px-1">
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-m-t1">{mockIdentityLabel(draft, order.length || null)}</span>
          <span className="text-[13px] font-medium text-m-t3">{mockFinishedLabel(draft.completed_at)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-2" data-report-stats>
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-0.5 rounded-[14px] bg-m-b1 px-3.5 py-2.5">
              <dt className="text-[12px] font-medium text-m-t3">{stat.label}</dt>
              <dd className="text-[20px] font-semibold tabular-nums leading-6 tracking-[-0.02em] text-m-t1">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {missing && <MNotice tone="error">{missing}</MNotice>}
      </div>
      {list}
      {canDelete && <DeleteReportSheet open={confirming} onOpenChange={setConfirming} draftId={draft.id} leagueId={draft.league_id} />}
    </ReportFrame>
  )
}

const ACTION = 'flex h-12 w-full flex-none items-center justify-center rounded-[14px] text-[15px] font-semibold'

/** Delete asks first (desktop's dialog, as a phone sheet). A delete that
 *  fails says why in the sheet and leaves it open to try again. */
function DeleteReportSheet({
  open,
  onOpenChange,
  draftId,
  leagueId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftId: string
  leagueId: string | null
}) {
  const router = useRouter()
  // `null` ⇒ the standalone door (`DELETE /api/mocks/[id]`); a league id ⇒
  // the league's. One hook, the shipped branch — no new route.
  const deleteMock = useDeleteMockDraft(leagueId)
  const [error, setError] = useState<string | null>(null)

  const confirm = () => {
    setError(null)
    deleteMock
      .mutateAsync(draftId)
      // The report is gone: land on the practice home, in its place (Back
      // must never return to a report that no longer exists).
      .then(() => router.replace(PRACTICE_HOME_HREF))
      .catch((cause: unknown) => setError(cause instanceof LeagueActionError || cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'))
  }

  return (
    <MobileSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
      title={MOCK_REPORT_COPY.deleteTitle}
      showClose
    >
      <div className="flex flex-col gap-2 px-4 pb-1" data-report-delete-sheet>
        <p className="px-1 pb-1.5 text-[15px] font-medium leading-[1.45] text-m-t2">{MOCK_REPORT_COPY.deleteBody}</p>
        {error && <MNotice tone="error">{error}</MNotice>}
        <button type="button" onClick={() => onOpenChange(false)} className={cn(ACTION, 'bg-accent text-white active:bg-accent-strong')}>
          {MOCK_REPORT_COPY.keep}
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={deleteMock.isPending}
          className={cn(ACTION, 'bg-m-b2 text-m-red active:bg-m-b2h disabled:text-m-t5')}
          data-report-delete-confirm
        >
          {deleteMock.isPending ? 'Deleting…' : MOCK_REPORT_COPY.delete}
        </button>
      </div>
    </MobileSheet>
  )
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the report" data-mock-report="loading">
      <div className="flex flex-col gap-3 px-4 pt-3">
        <span className="mx-1 block h-5 w-40 animate-pulse rounded-md bg-m-b1" />
        <div className="grid grid-cols-2 gap-2">
          <span className="block h-[62px] animate-pulse rounded-[14px] bg-m-b1" />
          <span className="block h-[62px] animate-pulse rounded-[14px] bg-m-b1" />
        </div>
      </div>
      <div className="px-4 pt-3">
        <RowsSkeleton />
      </div>
    </div>
  )
}
