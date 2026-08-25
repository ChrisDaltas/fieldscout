'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import type { LeagueDetail } from '@/hooks/use-league'
import {
  useDeleteMockDraft,
  useLaunchMockDraft,
  useMockDrafts,
  type MockDraftSummary,
} from '@/hooks/use-mock-drafts'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'

import {
  defaultMockSeatId,
  launchDisabledReason,
  leagueMockOpenBlocked,
  MOCK_CAP_NOTE,
  MOCK_EXPIRY_NOTE,
  mockIdentityLabel,
  mockProgressLabel,
  mockSeatCount,
  mockSeatOptions,
} from './mock-launcher-ops'

interface MockDraftLauncherProps {
  leagueId: string
  detail: LeagueDetail
  userId: string | null
}

/**
 * Mock-draft launcher (§16.2 `mock-draft-launcher`; §8.8 "Practice this
 * draft"; M2 task L.B3.5) — mounted at `?practice=1` on the draft-room route
 * (mock-launcher-entry.ts). Seat picker defaulting to the launcher's REAL
 * seat (any active seat selectable — the mock driver is launcher-keyed,
 * D103(2)), CPU speed toggle (bot think-time only — the human clock always
 * runs real, §8.8), the active-mocks resume list + recaps, and the §22.5
 * cap messaging. Every rule is the RPC's (071): the launch button goes
 * through `create_mock_draft`, and refusals (hourly cap, league status,
 * seat validity) surface verbatim.
 */
export function MockDraftLauncher({ leagueId, detail, userId }: MockDraftLauncherProps) {
  const router = useRouter()
  const mocks = useMockDrafts(leagueId)
  const launch = useLaunchMockDraft(leagueId)

  const seatOptions = useMemo(
    () => mockSeatOptions(detail.teams, detail.members, userId),
    [detail.teams, detail.members, userId],
  )
  const [seatId, setSeatId] = useState<string | null>(() => defaultMockSeatId(seatOptions))
  const [cpuSpeed, setCpuSpeed] = useState<'realistic' | 'fast'>('realistic')

  const activeCount = mocks.data?.active.length ?? 0
  const capReason = launchDisabledReason(activeCount)
  // §8.8: mocks launch from a PRE-draft league; past that the form would
  // only offer a refusal, so it gets the honest state instead (the resume/
  // recap lists still render — a paused mock or a kept recap outlives it).
  const preDraft = detail.league.status === 'setup' || detail.league.status === 'scheduled'

  const handleLaunch = () => {
    if (launch.isPending || capReason || !seatId) return
    launch
      .launchMockAsync({ human_team_id: seatId, cpu_speed: cpuSpeed })
      .then(({ draft }) => {
        // created:false is the SAME success (a replayed submit returns the
        // original mock — D110(11)); either way the launcher's room opens.
        router.push(`/app/leagues/${leagueId}/draft?draft=${draft.id}`)
      })
      .catch((error: unknown) => {
        toast({
          title: "Couldn't start the practice draft",
          description:
            error instanceof LeagueActionError
              ? error.message // the RPC's friendly refusal (caps, status, seat) verbatim
              : 'Something went wrong. Please try again.',
          variant: 'destructive',
        })
      })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Practice draft"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
          </Button>
        }
      />

      {/* R340: the launcher's OWN way out. The `PageHeader` above is a no-op
          since DR.1 moved the room out of the app shell, and this surface had
          ZERO links and ZERO buttons without this one (measured by DOM
          inventory 2026-08-18) — it is reached from the lobby's *Practice
          this draft*, so a member could walk in and be stuck. It sits at the
          container level rather than in a card because the two arms below are
          mutually exclusive (pre-draft form / past-draft notice) and one exit
          must cover both, plus every `MockList` state. DR.2 rehomes it onto
          the command bar's Exit Draft. Pinned in `room-exits.test.ts`. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
        </Button>
      </div>

      {preDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Icon name="rocket" size={15} className="mr-1.5 inline align-[-2px]" />
              Run mock draft
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-[12px] font-medium text-n-3">
              A solo run of YOUR draft — real settings, real order, real countdown — against
              CPU opponents. Nothing here touches the league (§8.8&apos;s promise, worded for
              humans: it&apos;s practice, not the draft).
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold">Draft from seat</span>
              <Select value={seatId ?? ''} onValueChange={setSeatId}>
                <SelectTrigger
                  className="h-btn-md w-full max-w-xs text-[12px] font-bold"
                  aria-label="Seat to practice from"
                >
                  <SelectValue placeholder="Choose a seat…" />
                </SelectTrigger>
                <SelectContent>
                  {seatOptions.map((o) => (
                    <SelectItem key={o.teamId} value={o.teamId}>
                      {o.name}
                      {o.isMine ? ' (your seat)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold">CPU speed</span>
              <Segment aria-label="CPU speed" className="w-fit">
                <SegmentItem
                  active={cpuSpeed === 'realistic'}
                  onClick={() => setCpuSpeed('realistic')}
                >
                  Realistic
                </SegmentItem>
                <SegmentItem active={cpuSpeed === 'fast'} onClick={() => setCpuSpeed('fast')}>
                  Fast
                </SegmentItem>
              </Segment>
              <p className="text-[10px] font-medium text-n-3">
                Affects bot think-time only — your own clock always runs real.
              </p>
            </div>

            {capReason && (
              // The §16.5.2 3-active cap message — honest BEFORE a refused
              // round-trip. A partial pre-flight: this league's actives only
              // (071 counts across ALL leagues — R280); the RPC still
              // enforces it and its refusal is the authority (D110(6)).
              <p className="text-[11px] font-semibold text-negative-strong" role="status">
                {capReason}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="blue"
                size="sm"
                shadow
                disabled={launch.isPending || Boolean(capReason) || !seatId}
                onClick={handleLaunch}
              >
                <Icon name="rocket" size={13} />
                {launch.isPending ? 'Setting up…' : 'Start practice draft'}
              </Button>
              <span className="text-[10px] font-medium text-n-3">{MOCK_CAP_NOTE}</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold">Practice launches before draft night</p>
            <p className="text-[12px] font-medium text-n-3">
              New practice drafts are for leagues still in setup or scheduled. Anything you
              already started or finished is below.
            </p>
          </CardContent>
        </Card>
      )}

      <MockList leagueId={leagueId} detail={detail} mocks={mocks} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active mocks (resume) + recaps — shared with the league-home card's data
// ---------------------------------------------------------------------------

function MockList({
  leagueId,
  detail,
  mocks,
}: {
  leagueId: string
  detail: LeagueDetail
  mocks: ReturnType<typeof useMockDrafts>
}) {
  if (mocks.isPending) {
    return <Skeleton className="h-24 rounded-sm" />
  }
  if (mocks.isError) {
    return (
      <Card className="border-negative bg-negative-soft">
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold" role="alert">
            Couldn&apos;t load your practice drafts.
          </p>
          <Button variant="stroke" size="sm" onClick={() => void mocks.refetch()}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { active, recaps } = mocks.data
  if (active.length === 0 && recaps.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-[12px] font-medium text-n-3">
            No practice drafts yet — your runs and their recaps will list here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your practice drafts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {active.map((row) => (
          <MockRow
            key={row.id}
            leagueId={leagueId}
            openBlocked={leagueMockOpenBlocked(row, featureFlags.mockDrafts)}
            seatCount={mockSeatCount(row, detail.teams)}
            row={row}
          />
        ))}
        {recaps.map((row) => (
          <MockRow
            key={row.id}
            leagueId={leagueId}
            openBlocked={leagueMockOpenBlocked(row, featureFlags.mockDrafts)}
            seatCount={mockSeatCount(row, detail.teams)}
            row={row}
          />
        ))}
        {active.length > 0 && (
          <p className="text-[10px] font-medium text-n-3">{MOCK_EXPIRY_NOTE}</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One resumable/recap row (§16.5.2). Exported and mounted THREE times now —
 * the launcher below, the league-home card, and MP.5's practice home. One
 * row treatment, no fork: MP.5 gave it props instead of a copy.
 *
 * **`leagueId: string | null` is the league-optional arm** (spec v2.16 §8.8
 * — practice is the purpose, a league is optional context). A standalone
 * mock has no league, so it gets neither league-scoped links nor the
 * league-scoped delete door; both branch on this one discriminant, taken
 * from `row.league_id` at the practice-home mount and from the surrounding
 * league everywhere else.
 *
 * **The standalone links point at routes MP.6 and MP.8 build**, and until
 * they land those two URLs 404. MP.6 moves the room to `/app/mocks/[mockId]`
 * because `(room)/leagues/layout.tsx` hard-redirects every `/app/leagues` URL
 * with the leagues flag off (D231(3a)/R470), and MP.8 owns
 * `/app/mocks/[mockId]/report`. Pointing them anywhere else today would be a
 * workaround MP.6 then has to find and undo — so the href stays, and
 * **`openBlocked` disables the control instead (R515)**. A disclosure that
 * lives only in a docblock is a disclosure the user never reads: a
 * live-styled button that dead-ends on a 404 page (which cannot even route
 * back to `/app/mocks`) is a lie the row is telling, and `disabled` + one
 * line of state is the honest version. **MP.6/MP.8 remove the reason, not
 * the link.**
 *
 * `openBlocked` also covers the OTHER way this row can offer a dead control:
 * a league-attached mock listed on `/app/mocks` while the leagues flag is off
 * (R519) — its link is real, and it silently redirects to `/app`. The caller
 * decides, because only the caller knows which surface it is on; a flag read
 * here would be a presentation gate buried in a shared row.
 *
 * `seatCount` is the progress line's denominator and is a NUMBER, not a
 * `LeagueDetail`: the practice home has no league to hand over, and it reads
 * the count off the row's own `config.mock.cpu_seats` instead
 * (`mockSeatCount`). Null ⇒ the label states the position with no total.
 */
export function MockRow({
  leagueId,
  seatCount,
  row,
  openBlocked = null,
}: {
  leagueId: string | null
  seatCount: number | null
  row: MockDraftSummary
  /** Why *Rejoin* / *View report* cannot be used yet, or null when it can.
   *  Disables the control and prints the reason on the row (R515/R519). */
  openBlocked?: string | null
}) {
  const deleteMock = useDeleteMockDraft(leagueId)
  const complete = row.status === 'complete'
  // **MP.8: EVERY finished mock has a "report"**, league-attached or not —
  // one surface, one word (D230(4): the league recap keeps REAL drafts, and
  // the legacy `?draft=<mock_id>` URL redirects into the report). Before
  // MP.8 this row branched, because only a standalone mock had somewhere
  // else to go; the branch is gone rather than widened.
  const finishedNoun = 'report'
  const openHref =
    leagueId === null
      ? `/app/mocks/${row.id}`
      : `/app/leagues/${leagueId}/draft?draft=${row.id}`
  const reportHref = `/app/mocks/${row.id}/report`
  const openLabel = complete
    ? `View ${finishedNoun}`
    : row.status === 'paused'
      ? 'Resume'
      : 'Rejoin'

  const handleDelete = () => {
    deleteMock.mutateAsync(row.id).catch((error: unknown) => {
      toast({
        title: complete
          ? `Couldn't delete the ${finishedNoun}`
          : "Couldn't delete the practice draft",
        description:
          error instanceof LeagueActionError ? error.message : 'Something went wrong.',
        variant: 'destructive',
      })
    })
  }

  return (
    // MP.10: the wrap is DECIDED rather than tipped. `flex-wrap` alone let a
    // one-word difference in badge width decide whether the action group sat
    // inline or dropped below — measured at 375px, a *Paused* row wrapped and
    // the *Live* row beside it did not, so two rows in one list disagreed
    // about their own shape. Below `sm` the actions take their own full-width
    // line every time; at `sm` and up they sit inline. The text block shrinks
    // (`min-w-0 flex-1`) instead of pushing them out.
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-sm border border-ink bg-white px-2.5 py-2">
      <Badge variant={complete ? 'stroke' : row.status === 'paused' ? 'yellow' : 'green'}>
        {complete
          ? 'Report'
          : row.status === 'paused'
            ? 'Paused'
            : 'Live'}
      </Badge>
      <div className="min-w-0 flex-1 basis-32">
        {/* What this run WAS — not the constant "Practice draft" every row
            used to print. See `mockIdentityLabel` (MP.10). */}
        <p className="truncate text-[12px] font-extrabold leading-tight">
          {mockIdentityLabel(row, seatCount)}
        </p>
        <p className="truncate text-[10px] font-semibold text-n-3">
          {complete
            ? row.completed_at
              ? `Finished ${new Date(row.completed_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}`
              : 'Finished'
            : mockProgressLabel(row, seatCount)}
        </p>
        {openBlocked && (
          <p className="truncate text-[10px] font-semibold text-n-3" role="status">
            {openBlocked}
          </p>
        )}
      </div>
      <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto">
        {openBlocked ? (
          // Not styled as the primary action either: a disabled blue button
          // still reads as "the thing to press". Stroke + disabled says
          // "later", which is what is true.
          <Button variant="stroke" size="sm" disabled>
            {openLabel}
          </Button>
        ) : complete ? (
          <Button variant="stroke" size="sm" asChild>
            <Link href={reportHref}>{openLabel}</Link>
          </Button>
        ) : (
          <Button variant="blue" size="sm" asChild>
            <Link href={openHref}>{openLabel}</Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteMock.isPending}
          onClick={handleDelete}
          aria-label={complete ? `Delete ${finishedNoun}` : 'Delete practice draft'}
        >
          {deleteMock.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
