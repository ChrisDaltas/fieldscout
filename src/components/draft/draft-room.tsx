'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/app-header'
import { AddDraftListModal } from '@/components/leagues/attach-list-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { MockBanner, ReconnectingBanner } from '@/components/leagues/status-banners'
import { useAuth } from '@/hooks/use-auth'
import {
  useDraftRoom,
  useMakePick,
  type DraftPickSummary,
  type DraftRoomConnection,
} from '@/hooks/use-draft'
import { usePauseResumeDraft } from '@/hooks/use-draft-controls'
import {
  draftQueueKeys,
  useDraftQueue,
  useUpdateDraftQueue,
  type DraftQueueRow,
} from '@/hooks/use-draft-queue'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { Draft } from '@/types/database'

import { AvailablePlayers } from './available-players'
import { draftedIdSet } from './available-players-ops'
import { CommishDraftPanel } from './commish-draft-panel'
import { canUseCommishPanel } from './commish-panel-ops'
import { DraftBoardGrid } from './draft-board-grid'
import { DraftLobby } from './draft-lobby'
import { DraftChat } from './draft-chat'
import {
  nextPickNumberForTeam,
  parseDraftOrder,
  pickLabel,
  recentPicks,
  type BoardModelInput,
} from './draft-board-ops'
import { DraftPick } from './draft-pick'
import type { OrderedDraftType } from './draft-order'
import { abbreviateName } from './mock-draft'
import { MockDraftLauncher } from './mock-draft-launcher'
import { MyListsPanel, type PoolOverlaySelection } from './my-lists-panel'
import { MyQueue } from './my-queue'
import { appendId, deriveQueueView, orderedIdsForSave } from './my-queue-ops'
import { MyRosterTracker } from './my-roster-tracker'
import { DraftPauseOverlay } from './pause-overlay'
import { PickClock } from './pick-clock'
import { pickClockView } from './pick-clock-ops'
import { PresenceBar, type PresenceSeat } from './presence-bar'

/** League statuses that can only be reached PAST a completed draft (§7.1) —
 *  the no-param room's recap-pointer arm (L.B3.5 2b). */
const POST_DRAFT_LEAGUE_STATUSES = new Set(['in_season', 'playoffs', 'complete'])

interface DraftRoomProps {
  leagueId: string
  /** Explicit draft id (`?draft=` — the mock room path; L.B3.5's launcher
   *  routes here). Absent ⇒ the league's active non-mock draft. */
  draftIdParam?: string
  /** `?practice=1` — mount the §16.2 mock-draft-launcher instead of the
   *  room (mock-launcher-entry's printed destination; L.B3.5). */
  practice?: boolean
}

/**
 * Draft room — §16.2's canonical file name since DR.1 (`git mv` from
 * `snake-draft-room.tsx`; C46/D135's consolidation executed one lane early
 * because DR.1 was already relocating the route). Line numbers are unchanged
 * by the rename, so the `snake-draft-room.tsx:NNN` citations in
 * `tasks-DR-draft-room-redesign.md` §1 still land — read the file name as
 * this one.
 *
 * DR.1 also moved the ROUTE into the `(room)` group, so this component now
 * renders inside a full-viewport, chrome-free frame with no app nav, header
 * or right rail (`src/app/app/(room)/layout.tsx`; spec §16.1 v2.12). Two
 * consequences a reader of this file needs:
 *   - The `PageHeader` calls below write into `useHeaderStore`, which only
 *     `AppHeader` reads — and `AppHeader` is shell chrome. They are therefore
 *     NO-OPS in the room today, which means the live room's **Exit room**
 *     button, the commissioner-panel trigger and **Pause practice** are not
 *     rendered anywhere. **DR.2 deletes these calls and rehomes all three
 *     onto the 54px command bar**, which is the same task that closes the
 *     shipped defect that none of them rendered below `lg`.
 *   - The resolver's empty / problem / not-found / post-draft states each
 *     carry their own "Back to league" button inside the card body, so those
 *     arms are not stranded by the missing chrome. DR.7 owns the sweep.
 *
 * The shell landed in L.B3.1 (realtime client, clock,
 * presence, §16.5.4 states); M2 task L.B3.2 lands the working surfaces of
 * §8.5.2: the rounds × teams board grid (D90 — made cells from rows, empty
 * future cells from the parity-pinned TS order mirror), available players
 * (C26 by-player_id subtraction, E17 live off the picks channel), my queue
 * (optimistic drag reorder — §15.6; drafted greyed/auto-removed — E17) and
 * the roster tracker (068's documented greedy as a display read-model).
 * Chat + the commissioner panel are L.B3.3; the recap surface is L.B3.5.
 * L.B4.2 lands §8.9's draft references: the My Lists panel as the rail tab
 * beside My Queue (a bottom sheet on mobile), the pool overlay, and the
 * room-level Add-a-draft-list modal.
 *
 * Mobile (§16.4): the room collapses to a picks ticker + the "my picks"
 * rail, with the full grid (and pool/queue/chat) one tap away on a Segment.
 *
 * L.B3.3 adds the §16.2 chat pane (`draft-chat` — the sanctioned direct
 * INSERT + the room channel's live feed), the §8.7 commissioner panel
 * (`commish-draft-panel` — commish/co-commish on NON-mock drafts only,
 * D110(1)), the §16.5.2 pause overlay with the frozen remaining time, and
 * the §16.5.4 autopick-on seat badges.
 */
export function DraftRoom({ leagueId, draftIdParam, practice }: DraftRoomProps) {
  const { user } = useAuth()
  const detail = useLeague(leagueId)

  const activeDraft = detail.data?.active_draft ?? null
  // The launcher path opens no room and needs no draft resolution — keep the
  // room's fetch-then-subscribe machinery entirely out of it.
  const draftId = practice ? undefined : (draftIdParam ?? activeDraft?.id)

  // My franchise (league_members → team_id). A mock resolves its own "You"
  // seat from config.mock inside the live room (D103(2)).
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

  if (practice) {
    // L.B3.5: the `?practice=1` launcher surface (§16.2) — every Practice
    // CTA routes here (mock-launcher-entry.ts flipped in the same PR).
    return (
      <MockDraftLauncher leagueId={leagueId} detail={detail.data} userId={user?.id ?? null} />
    )
  }

  if (!draftId) {
    if (detail.data.league.status === 'scheduled') {
      // L.B3.4: the D94 settings-only path — the league is scheduled but no
      // drafts row exists yet (the tick creates + starts it at the instant).
      // The lobby renders WITHOUT presence (no row ⇒ no channel) and polls
      // near the instant so the auto-start flip arrives.
      return (
        <DraftLobby
          leagueId={leagueId}
          detail={detail.data}
          draft={null}
          myTeamId={myMemberTeamId}
          isCommish={canUseCommishPanel(detail.data.my_role)}
        />
      )
    }
    if (POST_DRAFT_LEAGUE_STATUSES.has(detail.data.league.status)) {
      // L.B3.5 (2b): a completed REAL draft leaves no active row — the room's
      // honest state for a post-draft league is the recap pointer (§16.5.2's
      // draft-night row ends at `/draft/recap`; the recap page resolves the
      // completed draft itself).
      return (
        <div className="flex flex-col gap-4">
          <PageHeader title="Draft room" />
          <Card>
            <CardContent className="flex flex-col items-start gap-2 p-4">
              <p className="text-[13px] font-bold">This league’s draft is complete</p>
              <p className="text-[12px] font-medium text-n-3">
                The final board and every roster live on the draft recap.
              </p>
              <div className="flex items-center gap-2.5">
                <Button variant="blue" size="sm" shadow asChild>
                  <Link href={`/app/leagues/${leagueId}/draft/recap`}>View the recap</Link>
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
    // C25's honest state: no fixtures — no draft exists yet and the league
    // isn't scheduled, so there is no lobby to open either.
    return (
      <DraftRoomEmpty
        leagueId={leagueId}
        title="No draft yet"
        body="This league hasn’t scheduled its draft. The commissioner can schedule it from the league home."
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
    // L.B3.4: the pre-start room state IS the lobby (§8.5.1/§16.5.2). The
    // room's ONE channel is already open (useDraftRoom subscribed after the
    // fetch), so presence works here and the start flip arrives as the
    // drafts UPDATE broadcast — the lobby becomes the live room in place.
    return (
      <DraftLobby
        leagueId={leagueId}
        detail={detail.data}
        draft={draft}
        onlineTeamIds={room.onlineTeamIds}
        myTeamId={myMemberTeamId}
        isCommish={canUseCommishPanel(detail.data.my_role)}
      />
    )
  }

  if (draft.status === 'complete') {
    // The completion moment (§16.5.2's draft-night row ends at the recap):
    // when the final pick's broadcast flips `status` to complete, this
    // branch renders IN PLACE — the room's own "view the recap" beat. The
    // explicit `?draft=` keeps a mock's recap pointed at the mock (§16.1
    // serves real & mock).
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Draft room" />
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold">
              {draft.is_mock ? 'Practice draft complete' : 'This draft is complete'}
            </p>
            <p className="text-[12px] font-medium text-n-3">
              {draft.is_mock
                ? 'Every seat is filled. See how your board came together against the CPUs.'
                : 'Every seat is filled — the final board and rosters are on the recap.'}
            </p>
            <div className="flex items-center gap-2.5">
              <Button variant="blue" size="sm" shadow asChild>
                <Link href={`/app/leagues/${leagueId}/draft/recap?draft=${draft.id}`}>
                  View the recap
                </Link>
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
      userId={user?.id ?? null}
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
  userId: string | null
}

type MobilePane = 'players' | 'queue' | 'board' | 'chat'

function DraftRoomLive({
  leagueId,
  detail,
  draft,
  picks,
  connection,
  offsetMs,
  onlineTeamIds,
  myMemberTeamId,
  userId,
}: DraftRoomLiveProps) {
  const [mobilePane, setMobilePane] = useState<MobilePane>('players')
  // §8.9 (L.B4.2): the rail's My Queue | My Lists tab, the pool-overlay
  // selection (room-owned so panel and pool can never disagree), the
  // §16.4/§8.9 mobile bottom sheet hosting the panel, and the room-level
  // Add-a-draft-list modal (mounted OUTSIDE the sheet — a Dialog opened
  // from inside a Sheet steals focus and closes both, D119(6)).
  const [railTab, setRailTab] = useState<'queue' | 'lists'>('queue')
  const [overlay, setOverlay] = useState<PoolOverlaySelection | null>(null)
  const [listsSheetOpen, setListsSheetOpen] = useState(false)
  const [addListOpen, setAddListOpen] = useState(false)
  const queryClient = useQueryClient()

  // The add-list modal's Attached flags: MY attached list ids (fetched only
  // once the modal opens; shares the panel's query cache).
  const leagueListRows = useLeagueLists(leagueId, addListOpen)
  const myAttachedListIds = useMemo(
    () =>
      new Set(
        (leagueListRows.data ?? [])
          .filter((row) => row.owner_id === userId)
          .map((row) => row.list_id),
      ),
    [leagueListRows.data, userId],
  )

  const teamsById = useMemo(
    () => new Map(detail.teams.map((t) => [t.id, t])),
    [detail.teams],
  )
  const teamNameById = useMemo(
    () => new Map(detail.teams.map((t) => [t.id, t.name])),
    [detail.teams],
  )

  // In a mock, the human seat is `config.mock.human_team_id` and its ONLY
  // legal human driver is the launcher (D103(2)) — for anyone else in the
  // room, the mock has no "You" seat: no on-clock treatment, no pick
  // affordance (the route would refuse them with the solo-practice message
  // anyway — the UI must not offer what the engine forbids).
  const mockConfig = useMemo(() => {
    if (!draft.is_mock) return null
    const config = draft.config as {
      mock?: { human_team_id?: string; launched_by?: string }
    } | null
    return config?.mock ?? null
  }, [draft.is_mock, draft.config])
  const isMockLauncher = Boolean(
    mockConfig && userId && mockConfig.launched_by === userId,
  )
  const myTeamId = draft.is_mock
    ? isMockLauncher
      ? (mockConfig?.human_team_id ?? null)
      : null
    : myMemberTeamId

  const livePicks = useMemo(() => picks.filter((p) => !p.is_undone), [picks])
  const draftedIds = useMemo(() => draftedIdSet(picks), [picks])

  // ONE identity read for every picked player (world-readable `players` —
  // D92 read pattern); board cells + ticker + tracker all key into it.
  // Broadcast hint rows render a placeholder until the keyed refetch lands.
  const { playerById } = usePlayersByIds(
    useMemo(() => livePicks.map((p) => p.player_id), [livePicks]),
  )

  // Board geometry (D90): columns from the stored order; auction can never
  // be live in M2 (draft_start refuses it naming M3), so non-linear ⇒ snake.
  const order = useMemo(() => parseDraftOrder(draft.draft_order), [draft.draft_order])
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
      currentPickNumber: draft.current_pick_number,
    }),
    [order, draft.total_rounds, draftType, snakeReversal, livePicks, draft.current_pick_number],
  )

  // §16.5.4 autopick-on seat badge (L.B3.3): sourced from the §8.4 flag
  // (`league_members.is_autodraft` — the §8.7 any-team toggle writes it) OR
  // a seat with NO user (placeholder/vacated — E48's autopilot picks for it
  // at every deadline, so "Auto" is the honest label). Mock rooms render
  // neither: CPU behavior is mock runtime, not the §8.4 flag (068's ARM 2
  // mock branch zeroes is_autodraft), and a real-league flag badge inside a
  // practice room would mislead.
  const autopickTeamIds = useMemo(() => {
    if (draft.is_mock) return new Set<string>()
    const ids = new Set<string>()
    for (const member of detail.members) {
      if (member.team_id && (member.is_autodraft === true || !member.user_id)) {
        ids.add(member.team_id)
      }
    }
    return ids
  }, [draft.is_mock, detail.members])

  const seatIds = order.length > 0 ? order : detail.teams.map((t) => t.id)
  const seats: PresenceSeat[] = seatIds.map((teamId) => ({
    teamId,
    name: teamsById.get(teamId)?.name ?? 'Team',
    online: onlineTeamIds.has(teamId),
    onClock: teamId === draft.on_clock_team_id,
    isMe: teamId === myTeamId,
    autopick: autopickTeamIds.has(teamId),
  }))

  const onClockTeam = draft.on_clock_team_id
    ? teamsById.get(draft.on_clock_team_id)
    : undefined
  const youAreOnClock = Boolean(myTeamId) && draft.on_clock_team_id === myTeamId
  const paused = draft.status === 'paused'

  // §8.7 surface: commissioner/co-commissioner, NON-mock only (D110(1) —
  // the controls refuse mocks in-RPC; the UI must not offer them).
  const isCommish = canUseCommishPanel(detail.my_role) && !draft.is_mock
  const pauseResume = usePauseResumeDraft(leagueId, draft.id)
  // R272 (M2 batch 14): on a mock the LAUNCHER is the one legal resume (and
  // pause) caller — 069/071's mock-launcher arm; `isCommish` is always false
  // here (D110(1)), so without this the overlay dead-ended for the only
  // person who could act on it. §8.8's "pause/leave anytime" is the pause
  // button below; leaving just works (E59 auto-pauses on a stale heartbeat).
  const canPauseResume = isCommish || isMockLauncher
  // The §16.5.2 pause overlay's frozen clock — the paused branch reads only
  // the persisted deadline_remaining_ms, so the (nowMs, offsetMs) samples
  // are irrelevant here (pure derivation, no wall-clock read).
  const pausedClock = pickClockView(
    {
      status: draft.status,
      current_deadline: draft.current_deadline,
      deadline_remaining_ms: draft.deadline_remaining_ms,
    },
    0,
    0,
  )

  const myNextPick = useMemo(
    () =>
      nextPickNumberForTeam(
        order,
        draftType,
        snakeReversal,
        draft.current_pick_number,
        draft.total_rounds,
        myTeamId,
      ),
    [order, draftType, snakeReversal, draft.current_pick_number, draft.total_rounds, myTeamId],
  )

  // ----- pick submission (L.B2.2's route/hook, wired here — D92) -----------
  // NEVER optimistic (§15.6): the button shows "submitting…" (§16.3) and the
  // board reflects the broadcast/refetch; the E1 race loser's friendly
  // message surfaces verbatim.
  const makePick = useMakePick(leagueId, draft.id)
  const canDraft = youAreOnClock && draft.status === 'live'
  const handleDraft = (playerId: string) => {
    if (!canDraft || makePick.isPending) return
    // The hook's wrapper stamps ONE action_id per submit (D68(1)) so a
    // React Query retry replays server-side as E2 instead of double-picking.
    makePick.makePickAsync(playerId).catch((error: unknown) => {
      toast({
        title: 'Pick not made',
        description:
          error instanceof LeagueActionError
            ? error.message // the E1 loser's friendly line, verbatim (§16.3)
            : 'Something went wrong. The room refreshes automatically.',
        variant: 'destructive',
      })
    })
  }

  // ----- queue (own rows; a mock's launcher drives the human seat — D103(3))
  const queueTeamId = myTeamId
  const queue = useDraftQueue(draft.id, queueTeamId ?? undefined)
  const updateQueue = useUpdateDraftQueue(leagueId, draft.id, queueTeamId ?? '')
  const queueView = useMemo(
    () => deriveQueueView(queue.data ?? [], draftedIds),
    [queue.data, draftedIds],
  )
  const queuedIds = useMemo(
    () => new Set(queueView.filter((r) => !r.drafted).map((r) => r.player_id)),
    [queueView],
  )
  const handleQueue = (playerId: string) => {
    if (!queueTeamId) return
    // Read the queue from the LIVE cache at click time, not the render
    // closure: the optimistic onMutate writes the cache synchronously, so
    // two quick appends compose — the D39 pass caught the closure variant
    // losing the first append (two whole-queue replaces raced; the server
    // interleaving left duplicate rank-1 rows).
    const cached =
      queryClient.getQueryData<DraftQueueRow[]>(
        draftQueueKeys.queue(draft.id, queueTeamId),
      ) ?? []
    const currentIds = orderedIdsForSave(deriveQueueView(cached, draftedIds))
    updateQueue.mutate(appendId(currentIds, playerId))
  }

  const myPicks = useMemo(
    () => (myTeamId ? picks.filter((p) => p.team_id === myTeamId) : []),
    [picks, myTeamId],
  )

  const ticker = useMemo(() => recentPicks(livePicks, 6), [livePicks])
  const teamCount = seatIds.length

  const poolCard = (
    <AvailablePlayers
      draftedIds={draftedIds}
      queuedIds={queuedIds}
      userId={userId ?? undefined}
      canDraft={canDraft}
      draftSubmitting={makePick.isPending}
      canQueue={Boolean(queueTeamId)}
      onDraft={handleDraft}
      onQueue={handleQueue}
      overlay={overlay}
      onClearOverlay={() => setOverlay(null)}
    />
  )

  const queueCard = queueTeamId ? (
    <MyQueue
      leagueId={leagueId}
      draftId={draft.id}
      teamId={queueTeamId}
      draftedIds={draftedIds}
    />
  ) : null

  // §16.2 my-lists-panel (L.B4.2) — the tab beside My Queue (§8.9). The
  // mobile variant renders the same panel inside a bottom Sheet with the
  // cheat sheet inlined (no nested portals — D119(6)).
  const listsCard = (inline: boolean) => (
    <MyListsPanel
      leagueId={leagueId}
      draftId={draft.id}
      detail={detail}
      userId={userId}
      queueTeamId={queueTeamId}
      draftedIds={draftedIds}
      canDraft={canDraft}
      draftSubmitting={makePick.isPending}
      onDraft={handleDraft}
      onQueue={handleQueue}
      overlay={overlay}
      onOverlayChange={setOverlay}
      onAddList={() => {
        // The modal mounts at room level; leaving the sheet first keeps the
        // Dialog out of the Sheet's focus scope (D119(6)).
        setListsSheetOpen(false)
        setAddListOpen(true)
      }}
      inlineCheatSheet={inline}
    />
  )

  const trackerCard = myTeamId ? (
    <MyRosterTracker
      picks={myPicks}
      playerById={playerById}
      roster={detail.settings.roster_settings}
    />
  ) : null

  const chatCard = (
    <DraftChat leagueId={leagueId} draftId={draft.id} detail={detail} userId={userId} />
  )

  const boardCard = (
    // Relative host for the §16.5.2 pause overlay (it floats above the
    // board only — chat and the rail stay usable during a pause).
    <div className="relative min-w-0">
      {paused && (
        <DraftPauseOverlay
          clock={pausedClock}
          mock={draft.is_mock}
          canResume={canPauseResume}
          resuming={pauseResume.isPending}
          onResume={() =>
            pauseResume.mutateAsync({ action: 'resume' }).catch((error: unknown) => {
              toast({
                title: 'Resume failed',
                description:
                  error instanceof LeagueActionError
                    ? error.message
                    : 'Something went wrong. The room refreshes automatically.',
                variant: 'destructive',
              })
            })
          }
        />
      )}
    <Card>
      <CardHeader>
        <span className="text-[13px] font-extrabold">Draft board</span>
        <span className="fs-overline text-[9px] text-n-3">
          <span className="fs-num">{livePicks.length}</span> of{' '}
          <span className="fs-num">{(draft.total_rounds ?? 0) * teamCount}</span> picks made
        </span>
      </CardHeader>
      <CardContent>
        {order.length > 0 ? (
          <DraftBoardGrid
            model={boardInput}
            teamNameById={teamNameById}
            playerById={playerById}
            myTeamId={myTeamId}
          />
        ) : (
          // Degraded arm: a live draft always stores an order (066 sets it
          // at start) — render the flat made-pick list rather than a grid
          // geometry we'd have to invent.
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {[...livePicks]
              .sort((a, b) => a.pick_number - b.pick_number)
              .map((pick) => {
                const player = playerById.get(pick.player_id)
                return (
                  <DraftPick
                    key={pick.pick_number}
                    pick={pick.pick_number}
                    playerName={player ? abbreviateName(player.full_name) : pick.player_id}
                    position={player?.position}
                    team={player?.team ?? '—'}
                    byManager={teamsById.get(pick.team_id)?.name ?? null}
                  />
                )
              })}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Draft room"
        actions={
          <div className="flex items-center gap-1.5">
            {isCommish && (
              <CommishDraftPanel
                leagueId={leagueId}
                draft={draft}
                detail={detail}
                picks={picks}
                playerById={playerById}
              />
            )}
            {isMockLauncher && !paused && (
              // §8.8 "pause/leave anytime": the launcher's explicit pause
              // (069/071's mock-launcher arm — commissioners are refused on
              // mocks, D110(1)). Leaving without it also pauses, via the E59
              // stale-heartbeat arm; this button just makes it deliberate.
              <Button
                variant="stroke"
                size="sm"
                disabled={pauseResume.isPending}
                onClick={() =>
                  pauseResume.mutateAsync({ action: 'pause' }).catch((error: unknown) => {
                    toast({
                      title: 'Pause failed',
                      description:
                        error instanceof LeagueActionError
                          ? error.message
                          : 'Something went wrong. The room refreshes automatically.',
                      variant: 'destructive',
                    })
                  })
                }
              >
                {pauseResume.isPending ? 'Pausing…' : 'Pause practice'}
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}`}>Exit room</Link>
            </Button>
          </div>
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
              {myNextPick !== null && !youAreOnClock && (
                <span className="fs-overline hidden shrink-0 text-[9px] text-n-3 sm:inline">
                  Your next: <span className="fs-num">{pickLabel(myNextPick, teamCount)}</span>
                </span>
              )}
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
          <CardContent>
            <PresenceBar seats={seats} />
          </CardContent>
        </Card>

        {/* ----- Desktop (lg+): board + working rail (§8.5.2) ----- */}
        <div className="hidden min-w-0 gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">{boardCard}</div>
          <div className="flex min-w-0 flex-col gap-4">
            {poolCard}
            {/* §8.9: My Lists is a TAB beside My Queue. */}
            <div className="flex min-w-0 flex-col gap-2">
              <Segment aria-label="Draft prep" className="w-full">
                <SegmentItem
                  active={railTab === 'queue'}
                  onClick={() => setRailTab('queue')}
                  className="flex-1"
                >
                  My queue
                </SegmentItem>
                <SegmentItem
                  active={railTab === 'lists'}
                  onClick={() => setRailTab('lists')}
                  className="flex-1"
                >
                  My lists
                </SegmentItem>
              </Segment>
              {railTab === 'queue' ? (
                (queueCard ?? (
                  <p className="text-[12px] font-medium text-n-3">
                    {draft.is_mock
                      ? 'Only the mock’s launcher drives a practice queue.'
                      : 'You don’t hold a seat in this draft, so there’s no queue to build.'}
                  </p>
                ))
              ) : (
                listsCard(false)
              )}
            </div>
            {trackerCard}
            {chatCard}
          </div>
        </div>

        {/* ----- Mobile (§16.4): ticker + my rail; grid one tap away ----- */}
        <div className="flex min-w-0 flex-col gap-4 lg:hidden">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Recent picks">
            {draft.current_pick_number !== null && !paused && (
              <DraftPick
                pick={draft.current_pick_number}
                empty
                onClock
                label={pickLabel(draft.current_pick_number, teamCount)}
                className="w-28 shrink-0"
              />
            )}
            {ticker.map((pick) => {
              const player = playerById.get(pick.player_id)
              return (
                <DraftPick
                  key={pick.pick_number}
                  pick={pick.pick_number}
                  label={pickLabel(pick.pick_number, teamCount)}
                  playerName={player ? abbreviateName(player.full_name) : pick.player_id}
                  position={player?.position}
                  team={player?.team ?? '—'}
                  byManager={teamsById.get(pick.team_id)?.name ?? null}
                  className="w-36 shrink-0"
                />
              )
            })}
            {ticker.length === 0 && draft.current_pick_number === null && (
              <p className="text-[12px] font-medium text-n-3">No picks yet.</p>
            )}
          </div>

          {myTeamId && (
            <Card>
              <CardHeader>
                <span className="text-[13px] font-extrabold">My picks</span>
                {myNextPick !== null && (
                  <span className="fs-overline text-[9px] text-n-3">
                    Next: <span className="fs-num">{pickLabel(myNextPick, teamCount)}</span>
                  </span>
                )}
              </CardHeader>
              <CardContent>
                <MyRosterTracker
                  compact
                  picks={myPicks}
                  playerById={playerById}
                  roster={detail.settings.roster_settings}
                />
              </CardContent>
            </Card>
          )}

          <Segment aria-label="Room view" className="w-full">
            <SegmentItem
              active={mobilePane === 'players'}
              onClick={() => setMobilePane('players')}
              className="flex-1"
            >
              Players
            </SegmentItem>
            <SegmentItem
              active={mobilePane === 'queue'}
              onClick={() => setMobilePane('queue')}
              className="flex-1"
            >
              Queue
            </SegmentItem>
            <SegmentItem
              active={mobilePane === 'board'}
              onClick={() => setMobilePane('board')}
              className="flex-1"
            >
              Full board
            </SegmentItem>
            <SegmentItem
              active={mobilePane === 'chat'}
              onClick={() => setMobilePane('chat')}
              className="flex-1"
            >
              Chat
            </SegmentItem>
          </Segment>

          {mobilePane === 'players' && poolCard}
          {mobilePane === 'queue' && (
            <>
              {queueCard ?? (
                <p className="text-[12px] font-medium text-n-3">
                  {draft.is_mock
                    ? 'Only the mock’s launcher drives a practice queue.'
                    : 'You don’t hold a seat in this draft, so there’s no queue to build.'}
                </p>
              )}
              {/* §8.9 mobile: the My Lists panel is a BOTTOM SHEET. */}
              <Button
                variant="stroke"
                size="sm"
                className="w-fit"
                onClick={() => setListsSheetOpen(true)}
              >
                <Icon name="list" size={13} />
                My lists
              </Button>
            </>
          )}
          {mobilePane === 'board' && boardCard}
          {mobilePane === 'chat' && chatCard}
        </div>
      </div>

      {/* §8.9 "Mobile: the panel is a bottom sheet" — the same MyListsPanel,
          cheat sheet inlined (no nested portals, D119(6)). */}
      <Sheet open={listsSheetOpen} onOpenChange={setListsSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>My lists</SheetTitle>
          </SheetHeader>
          {listsCard(true)}
        </SheetContent>
      </Sheet>

      {/* The lifted Add-a-draft-list modal (D119(6): outside every Sheet). */}
      <AddDraftListModal
        open={addListOpen}
        onOpenChange={setAddListOpen}
        leagueId={leagueId}
        leagueName={detail.league.name}
        scoringSystemId={detail.league.scoring_system_id}
        attachedListIds={myAttachedListIds}
      />
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
