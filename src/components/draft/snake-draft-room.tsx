'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { MockBanner, ReconnectingBanner } from '@/components/leagues/status-banners'
import { useAuth } from '@/hooks/use-auth'
import {
  useDraftRoom,
  type DraftPickSummary,
  type DraftRoomConnection,
} from '@/hooks/use-draft'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Draft } from '@/types/database'

import { DraftPick } from './draft-pick'
import { abbreviateName } from './mock-draft'
import { PickClock } from './pick-clock'
import { PresenceBar, type PresenceSeat } from './presence-bar'

interface SnakeDraftRoomProps {
  leagueId: string
  /** Explicit draft id (`?draft=` — the mock room path; L.B3.5's launcher
   *  routes here). Absent ⇒ the league's active non-mock draft. */
  draftIdParam?: string
}

/**
 * Draft room (M2 task L.B3.1) — re-skinned IN PLACE from the mock-fixture
 * simulation to REAL data: the drafts row + picks over `useDraftRoom`
 * (fetch-then-subscribe, gap ⇒ refetch — §9.3), the on-clock header, the
 * server-deadline `pick-clock`, the Presence-keyed `presence-bar`, the MOCK
 * banner (§16.2), and the §16.5.4 reconnecting banner.
 *
 * SCOPE SEAM (tasks-M2): this task is the room SHELL. The rounds×teams
 * board grid with future cells (D90 parity-pinned order helpers), the
 * available-players pool (C26's player_id subtraction), my-queue and the
 * roster tracker land in L.B3.2; chat + the commissioner panel in L.B3.3.
 * Until then the board area renders the made picks (real rows) plus the
 * single on-clock cell the drafts row itself names — nothing fabricated.
 */
export function SnakeDraftRoom({ leagueId, draftIdParam }: SnakeDraftRoomProps) {
  const { user } = useAuth()
  const detail = useLeague(leagueId)

  const activeDraft = detail.data?.active_draft ?? null
  const draftId = draftIdParam ?? activeDraft?.id

  // My franchise (league_members → team_id); in a mock the "my" seat is the
  // launcher's CHOSEN seat (config.mock.human_team_id — D103(2)), resolved
  // below once the draft row is loaded.
  const myMemberTeamId = useMemo(() => {
    if (!user || !detail.data) return null
    return detail.data.members.find((m) => m.user_id === user.id)?.team_id ?? null
  }, [user, detail.data])

  const room = useDraftRoom(draftId, {
    presence: { team_id: myMemberTeamId, user_id: user?.id ?? null },
  })

  // ----- resolution states (§16.5.4: skeleton / error / honest empties) ----

  if (detail.isPending || (draftId && room.isPending)) {
    return <DraftRoomSkeleton />
  }

  if (detail.isError || !detail.data) {
    return (
      <DraftRoomProblem
        leagueId={leagueId}
        title="Couldn't load this league."
        body="It may have been removed, or you no longer have access."
        onRetry={() => void detail.refetch()}
      />
    )
  }

  if (!draftId) {
    // C25's honest state: no fixtures — no draft exists yet. The draft-setup
    // surface + lobby live on the league home (L.B3.4 completes them).
    return (
      <DraftRoomEmpty
        leagueId={leagueId}
        title="No draft yet"
        body={
          detail.data.settings.draft.draft_scheduled_at
            ? 'This league has a draft scheduled but the room hasn’t opened. Head back to the league to see the countdown.'
            : 'This league hasn’t scheduled its draft. The commissioner can set it up from the league home.'
        }
      />
    )
  }

  if (room.isError) {
    return (
      <DraftRoomProblem
        leagueId={leagueId}
        title="Couldn't load the draft."
        body="The room state didn't come back. Retry, or head back to the league."
        onRetry={() => void room.refetch()}
      />
    )
  }

  const draft = room.data?.draft ?? null

  if (!draft || draft.league_id !== leagueId) {
    // RLS returned no row (not a member / unknown id) or the id belongs to
    // another league — one indistinguishable honest state, no leak.
    return (
      <DraftRoomEmpty
        leagueId={leagueId}
        title="Draft not found"
        body="There's no draft here by that id. Head back to the league."
      />
    )
  }

  if (draft.status === 'scheduled') {
    return (
      <DraftRoomEmpty
        leagueId={leagueId}
        title="The draft hasn't started"
        body="The room opens when the draft starts. Watch the countdown on the league home."
      />
    )
  }

  if (draft.status === 'complete') {
    // The recap surface (real & mock — §16.1 /draft/recap) is L.B3.5's.
    return (
      <DraftRoomEmpty
        leagueId={leagueId}
        title="This draft is complete"
        body="The final board and rosters live on the league home. The draft recap arrives with the next update."
      />
    )
  }

  return (
    <DraftRoomLive
      leagueId={leagueId}
      detail={detail.data}
      draft={draft}
      picks={room.data?.picks ?? []}
      connection={room.connection}
      offsetMs={room.offsetMs}
      onlineTeamIds={room.onlineTeamIds}
      myMemberTeamId={myMemberTeamId}
    />
  )
}

// ---------------------------------------------------------------------------
// The live room (status live | paused)
// ---------------------------------------------------------------------------

interface DraftRoomLiveProps {
  leagueId: string
  detail: LeagueDetail
  draft: Draft
  picks: DraftPickSummary[]
  connection: DraftRoomConnection
  offsetMs: number
  onlineTeamIds: ReadonlySet<string>
  myMemberTeamId: string | null
}

/** Identity row for a picked player (players is world-readable — direct
 *  RLS SELECT per the D92 read pattern; names/positions for the pick cells). */
interface PickedPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
}

function DraftRoomLive({
  leagueId,
  detail,
  draft,
  picks,
  connection,
  offsetMs,
  onlineTeamIds,
  myMemberTeamId,
}: DraftRoomLiveProps) {
  const teamsById = useMemo(
    () => new Map(detail.teams.map((t) => [t.id, t])),
    [detail.teams],
  )

  // In a mock, the human seat is the launcher's chosen one (D103(2)) — that
  // is the seat "You" means for the on-clock treatment.
  const mockHumanTeamId = useMemo(() => {
    if (!draft.is_mock) return null
    const config = draft.config as { mock?: { human_team_id?: string } } | null
    return config?.mock?.human_team_id ?? null
  }, [draft.is_mock, draft.config])
  const myTeamId = draft.is_mock ? mockHumanTeamId : myMemberTeamId

  const livePicks = useMemo(() => picks.filter((p) => !p.is_undone), [picks])

  // Names for the made picks — one world-readable players read keyed on the
  // picked ids; broadcast hint rows render a placeholder until it refreshes.
  const playerIds = useMemo(
    () => Array.from(new Set(livePicks.map((p) => p.player_id))).sort(),
    [livePicks],
  )
  const playersQuery = useQuery({
    queryKey: ['draft-room-players', playerIds],
    enabled: playerIds.length > 0,
    queryFn: async (): Promise<PickedPlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('players')
        .select('id, full_name, position, team')
        .in('id', playerIds)
      if (error) throw error
      return (data ?? []) as PickedPlayer[]
    },
  })
  const playerById = useMemo(
    () => new Map((playersQuery.data ?? []).map((p) => [p.id, p])),
    [playersQuery.data],
  )

  // Seat order: the stored draft_order when present (round-1 slots), else
  // franchise creation order. The full snake board derivation is L.B3.2's.
  const seatIds = useMemo(() => {
    const order = Array.isArray(draft.draft_order)
      ? (draft.draft_order as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    return order.length > 0 ? order : detail.teams.map((t) => t.id)
  }, [draft.draft_order, detail.teams])

  const seats: PresenceSeat[] = seatIds.map((teamId) => ({
    teamId,
    name: teamsById.get(teamId)?.name ?? 'Team',
    online: onlineTeamIds.has(teamId),
    onClock: teamId === draft.on_clock_team_id,
    isMe: teamId === myTeamId,
  }))

  const onClockTeam = draft.on_clock_team_id
    ? teamsById.get(draft.on_clock_team_id)
    : undefined
  const youAreOnClock = Boolean(myTeamId) && draft.on_clock_team_id === myTeamId
  const paused = draft.status === 'paused'

  // Made picks ascending + the one cell the drafts row itself names as on
  // the clock. Future cells need the D90-parity order helpers — L.B3.2.
  const boardCells = useMemo(() => {
    const cells = [...livePicks].sort((a, b) => a.pick_number - b.pick_number)
    return cells
  }, [livePicks])

  return (
    <>
      <PageHeader
        title="Draft room"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Exit room</Link>
          </Button>
        }
      />

      <div className="flex min-w-0 flex-col gap-4">
        {draft.is_mock && <MockBanner />}
        {connection === 'reconnecting' && (
          <ReconnectingBanner>
            Reconnecting — syncing the room. Picks refresh automatically.
          </ReconnectingBanner>
        )}

        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-2.5">
              {paused ? (
                <Badge variant="yellow" className="shrink-0">
                  Paused
                </Badge>
              ) : (
                <Badge variant="green" className="shrink-0">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-current" />
                  Live
                </Badge>
              )}
              <span className="truncate text-[13px] font-extrabold">
                Round <span className="fs-num">{draft.current_round ?? '—'}</span> · Pick{' '}
                <span className="fs-num">{draft.current_pick_number ?? '—'}</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={youAreOnClock ? 'fs-overline text-accent-strong' : 'fs-overline text-n-3'}
              >
                {youAreOnClock
                  ? "You're on the clock"
                  : onClockTeam
                    ? `On the clock · ${onClockTeam.name}`
                    : 'On the clock'}
              </span>
              <PickClock
                draft={{
                  status: draft.status,
                  current_deadline: draft.current_deadline,
                  deadline_remaining_ms: draft.deadline_remaining_ms,
                }}
                offsetMs={offsetMs}
              />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <PresenceBar seats={seats} />

            {boardCells.length === 0 && draft.on_clock_team_id === null ? (
              <p className="text-[12px] font-medium text-n-3">No picks yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {boardCells.map((pick) => {
                  const player = playerById.get(pick.player_id)
                  return (
                    <DraftPick
                      key={pick.pick_number}
                      pick={pick.pick_number}
                      playerName={
                        player ? abbreviateName(player.full_name) : pick.player_id
                      }
                      position={player?.position}
                      team={player?.team ?? '—'}
                      byManager={teamsById.get(pick.team_id)?.name ?? null}
                    />
                  )
                })}
                {draft.current_pick_number !== null && !paused && (
                  <DraftPick pick={draft.current_pick_number} empty onClock />
                )}
              </div>
            )}

            {/* L.B3.2 seam: rounds×teams grid, pool, queue, tracker. */}
            <p className="fs-overline text-[9px] text-n-3">
              <span className="fs-num">{boardCells.length}</span> of{' '}
              <span className="fs-num">{(draft.total_rounds ?? 0) * seatIds.length}</span> picks
              made
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Skeleton / problem / honest-empty states (§16.5.4)
// ---------------------------------------------------------------------------

function DraftRoomSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Draft room" />
      <Skeleton className="h-9 rounded-sm" />
      <Skeleton className="h-64 rounded-sm" />
    </div>
  )
}

function DraftRoomProblem({
  leagueId,
  title,
  body,
  onRetry,
}: {
  leagueId: string
  title: string
  body: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Draft room" />
      <Card className="border-negative bg-negative-soft">
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold" role="alert">
            {title}
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

function DraftRoomEmpty({
  leagueId,
  title,
  body,
}: {
  leagueId: string
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Draft room" />
      <Card>
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold">{title}</p>
          <p className="text-[12px] font-medium text-n-3">{body}</p>
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Back to league</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
