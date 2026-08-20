'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useCompletedRealDraft, useDraft, type DraftPickSummary } from '@/hooks/use-draft'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useDeleteMockDraft } from '@/hooks/use-mock-drafts'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'
import type { Draft } from '@/types/database'

import { DraftBoardGrid } from './draft-board-grid'
import {
  abbreviateName,
  parseDraftOrder,
  pickLabel,
  type BoardModelInput,
} from './draft-board-ops'
import type { OrderedDraftType } from './draft-order'
import { recapRostersFromPicks, recapTeamOrder, recapVariant } from './draft-recap-ops'
import { MockBanner } from '@/components/leagues/status-banners'

interface DraftRecapProps {
  leagueId: string
  /** `?draft=<id>` — a specific completed draft (the mock path, and the
   *  room's completion CTA). Absent ⇒ the league's completed REAL draft. */
  draftIdParam?: string
}

/**
 * Draft recap — §16.1 `/draft/recap`, "real & mock: final board + rosters
 * (mock: delete)" (M2 task L.B3.5; §8.8's kept recap; §16.5.2's draft-night
 * row ends here). One surface, two variants:
 *
 *  - **mock** — the §16.2 `mock-recap`: full board + YOUR roster vs the
 *    CPUs' + delete (launcher-only — the RPC refuses everyone else and the
 *    UI offers it to no one else);
 *  - **real** — the same board + ALL rosters, NO delete affordance (a real
 *    draft's record isn't anyone's to erase; post-completion resets are
 *    M6's, F44).
 *
 * Rosters derive from `draft_picks` for BOTH variants (draft-recap-ops.ts):
 * a mock writes no `league_rosters` (D103's zero side effects), so the
 * picks sheet is the one source the variants share; the member RLS SELECT
 * covers both. This is a static read — no channel, no clock (`useDraft`'s
 * fetch half only; a complete draft broadcasts nothing).
 */
export function DraftRecap({ leagueId, draftIdParam }: DraftRecapProps) {
  const { user } = useAuth()
  const detail = useLeague(leagueId)
  // No-param resolution: the league's completed REAL draft (mocks are
  // reachable by explicit id only — a practice room is its launcher's).
  const completedReal = useCompletedRealDraft(draftIdParam ? undefined : leagueId)
  const draftId = draftIdParam ?? completedReal.data?.id
  const room = useDraft(draftId)

  if (
    detail.isPending ||
    (!draftIdParam && completedReal.isPending) ||
    (draftId && room.isPending)
  ) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Draft recap" />
        <Skeleton className="h-9 rounded-sm" />
        <Skeleton className="h-64 rounded-sm" />
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <RecapProblem
        leagueId={leagueId}
        body="Couldn't load this league. It may have been removed, or you no longer have access."
        onRetry={() => void detail.refetch()}
      />
    )
  }

  if (!draftIdParam && completedReal.isError) {
    return (
      <RecapProblem
        leagueId={leagueId}
        body="Couldn't look up this league's completed draft. Retry, or head back to the league."
        onRetry={() => void completedReal.refetch()}
      />
    )
  }

  if (room.isError) {
    return (
      <RecapProblem
        leagueId={leagueId}
        body="The draft didn't come back. Retry, or head back to the league."
        onRetry={() => void room.refetch()}
      />
    )
  }

  const draft = room.data?.draft ?? null

  if (!draftId || !draft || draft.league_id !== leagueId || draft.status !== 'complete') {
    // One indistinguishable honest state (no leak): no completed draft here,
    // an id RLS won't show us, a cross-league id, or a draft still running.
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Draft recap" />
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold">No recap here yet</p>
            <p className="text-[12px] font-medium text-n-3">
              A recap appears once a draft finishes. Head back to the league for the current
              state of things.
            </p>
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <DraftRecapBody
      leagueId={leagueId}
      detail={detail.data}
      draft={draft}
      picks={room.data?.picks ?? []}
      userId={user?.id ?? null}
    />
  )
}

// ---------------------------------------------------------------------------
// The recap body (draft + picks resolved)
// ---------------------------------------------------------------------------

function DraftRecapBody({
  leagueId,
  detail,
  draft,
  picks,
  userId,
}: {
  leagueId: string
  detail: LeagueDetail
  draft: Draft
  picks: DraftPickSummary[]
  userId: string | null
}) {
  const teamNameById = useMemo(
    () => new Map(detail.teams.map((t) => [t.id, t.name])),
    [detail.teams],
  )
  const myMemberTeamId = useMemo(() => {
    if (!userId) return null
    return detail.members.find((m) => m.user_id === userId)?.team_id ?? null
  }, [detail.members, userId])

  const variant = recapVariant(draft, userId, myMemberTeamId)
  const rosters = useMemo(() => recapRostersFromPicks(picks), [picks])
  const order = useMemo(() => parseDraftOrder(draft.draft_order), [draft.draft_order])
  const anchorTeamId = variant.kind === 'mock' ? variant.humanTeamId : variant.myTeamId
  const teamOrder = useMemo(
    () => recapTeamOrder(order, rosters, anchorTeamId),
    [order, rosters, anchorTeamId],
  )

  const livePicks = useMemo(() => picks.filter((p) => !p.is_undone), [picks])
  const { playerById } = usePlayersByIds(
    useMemo(() => livePicks.map((p) => p.player_id), [livePicks]),
  )

  // Final board: the same D90 grid the room renders, with no on-clock cell —
  // the draft is over, nothing is pending.
  const draftType: OrderedDraftType = draft.draft_type === 'linear' ? 'linear' : 'snake'
  const snakeReversal = useMemo(() => {
    const config = draft.config as { snake_reversal?: unknown } | null
    return config?.snake_reversal === true
  }, [draft.config])
  const boardInput: BoardModelInput = useMemo(
    () => ({
      order,
      totalRounds: draft.total_rounds,
      draftType,
      snakeReversal,
      picks: livePicks,
      currentPickNumber: null,
    }),
    [order, draft.total_rounds, draftType, snakeReversal, livePicks],
  )
  const teamCount = order.length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Draft recap"
        actions={
          <div className="flex items-center gap-1.5">
            {variant.kind === 'mock' && variant.canDelete && (
              <DeleteRecapButton leagueId={leagueId} draftId={draft.id} />
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
            </Button>
          </div>
        }
      />

      {draft.is_mock && <MockBanner />}

      <Card>
        <CardHeader>
          <CardTitle>Final board</CardTitle>
          <span className="fs-overline text-[9px] text-n-3">
            <span className="fs-num">{livePicks.length}</span> picks ·{' '}
            <span className="fs-num">{draft.total_rounds ?? 0}</span> rounds
          </span>
        </CardHeader>
        <CardContent>
          {order.length > 0 ? (
            <DraftBoardGrid
              model={boardInput}
              teamNameById={teamNameById}
              playerById={playerById}
              myTeamId={anchorTeamId}
            />
          ) : (
            <p className="text-[12px] font-medium text-n-3">
              This draft stored no order to lay the board out with.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {variant.kind === 'mock' ? 'Your roster vs the CPUs' : 'Rosters'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {teamOrder.map((teamId) => (
              <RecapRosterCard
                key={teamId}
                teamName={teamNameById.get(teamId) ?? 'Team'}
                picks={rosters.get(teamId) ?? []}
                playerById={playerById}
                teamCount={teamCount}
                anchor={teamId === anchorTeamId}
                anchorLabel={
                  variant.kind === 'mock' ? 'Your seat' : 'You'
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function RecapRosterCard({
  teamName,
  picks,
  playerById,
  teamCount,
  anchor,
  anchorLabel,
}: {
  teamName: string
  picks: DraftPickSummary[]
  playerById: ReadonlyMap<string, PlayerIdentity>
  teamCount: number
  anchor: boolean
  anchorLabel: string
}) {
  return (
    // Selected-state is a resting condition — carried by border/fill, never
    // a shadow (CLAUDE.md elevation rule).
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-sm border p-2.5',
        anchor ? 'border-accent bg-accent-soft' : 'border-ink bg-white',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-extrabold">{teamName}</span>
        {anchor && <Badge variant="accent">{anchorLabel}</Badge>}
      </div>
      {picks.length === 0 ? (
        <p className="text-[10px] font-medium text-n-3">No picks on the final board.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {picks.map((pick) => {
            const player = playerById.get(pick.player_id)
            return (
              <li key={pick.pick_number} className="flex items-center gap-1.5 text-[11px]">
                <span className="fs-num w-9 shrink-0 text-[10px] font-bold text-n-3">
                  {teamCount > 0 ? pickLabel(pick.pick_number, teamCount) : `#${pick.pick_number}`}
                </span>
                {player && <PositionBadge position={player.position} size="sm" />}
                <span className="min-w-0 truncate font-bold">
                  {player ? abbreviateName(player.full_name) : pick.player_id}
                </span>
                {pick.is_auto && (
                  <span className="fs-overline shrink-0 text-[8px] text-n-3">Auto</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete (mock recaps only — §8.8 "until the user deletes it")
// ---------------------------------------------------------------------------

function DeleteRecapButton({ leagueId, draftId }: { leagueId: string; draftId: string }) {
  const router = useRouter()
  const deleteMock = useDeleteMockDraft(leagueId)
  const [open, setOpen] = useState(false)

  const handleDelete = () => {
    deleteMock
      .mutateAsync(draftId)
      .then(() => {
        router.push(`/app/leagues/${leagueId}`)
      })
      .catch((error: unknown) => {
        setOpen(false)
        toast({
          title: "Couldn't delete the recap",
          description:
            error instanceof LeagueActionError ? error.message : 'Something went wrong.',
          variant: 'destructive',
        })
      })
  }

  return (
    <>
      <Button variant="stroke" size="sm" onClick={() => setOpen(true)}>
        <Icon name="close" size={13} />
        Delete recap
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this practice recap?</DialogTitle>
            <DialogDescription>
              The board and rosters from this practice run go away for good. Your league is
              untouched — this only ever was practice.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMock.isPending}
              onClick={handleDelete}
            >
              {deleteMock.isPending ? 'Deleting…' : 'Delete recap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------

function RecapProblem({
  leagueId,
  body,
  onRetry,
}: {
  leagueId: string
  body: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Draft recap" />
      <Card className="border-negative bg-negative-soft">
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold" role="alert">
            Couldn&apos;t load the recap.
          </p>
          <p className="text-[12px] font-medium text-n-3">{body}</p>
          <div className="flex items-center gap-2.5">
            <Button variant="stroke" size="sm" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
