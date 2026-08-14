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
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'

import {
  defaultMockSeatId,
  launchDisabledReason,
  MOCK_CAP_NOTE,
  MOCK_EXPIRY_NOTE,
  mockProgressLabel,
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

      {preDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Icon name="rocket" size={15} className="mr-1.5 inline align-[-2px]" />
              Practice this draft
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
              // round-trip (the RPC still enforces it; D110(6)).
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
          <MockRow key={row.id} leagueId={leagueId} detail={detail} row={row} />
        ))}
        {recaps.map((row) => (
          <MockRow key={row.id} leagueId={leagueId} detail={detail} row={row} />
        ))}
        {active.length > 0 && (
          <p className="text-[10px] font-medium text-n-3">{MOCK_EXPIRY_NOTE}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** One resumable/recap row (§16.5.2). Exported for the league-home card —
 *  one row treatment, two mounts, no fork. */
export function MockRow({
  leagueId,
  detail,
  row,
}: {
  leagueId: string
  detail: LeagueDetail
  row: MockDraftSummary
}) {
  const deleteMock = useDeleteMockDraft(leagueId)
  const teamCount = detail.teams.filter((t) => t.status !== 'retired').length
  const complete = row.status === 'complete'

  const handleDelete = () => {
    deleteMock.mutateAsync(row.id).catch((error: unknown) => {
      toast({
        title: complete ? "Couldn't delete the recap" : "Couldn't delete the practice draft",
        description:
          error instanceof LeagueActionError ? error.message : 'Something went wrong.',
        variant: 'destructive',
      })
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-sm border border-ink bg-white px-2.5 py-2">
      <Badge variant={complete ? 'stroke' : row.status === 'paused' ? 'yellow' : 'green'}>
        {complete ? 'Recap' : row.status === 'paused' ? 'Paused' : 'Live'}
      </Badge>
      <div className="mr-auto min-w-0">
        <p className="truncate text-[12px] font-extrabold leading-tight">Practice draft</p>
        <p className="truncate text-[10px] font-semibold text-n-3">
          {complete
            ? row.completed_at
              ? `Finished ${new Date(row.completed_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}`
              : 'Finished'
            : mockProgressLabel(row, teamCount > 0 ? teamCount : null)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {complete ? (
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}/draft/recap?draft=${row.id}`}>View recap</Link>
          </Button>
        ) : (
          <Button variant="blue" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}/draft?draft=${row.id}`}>
              {row.status === 'paused' ? 'Resume' : 'Rejoin'}
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteMock.isPending}
          onClick={handleDelete}
          aria-label={complete ? 'Delete recap' : 'Delete practice draft'}
        >
          {deleteMock.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
