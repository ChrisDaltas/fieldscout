'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AddDraftListModal } from '@/components/leagues/attach-list-modal'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import {
  useDraftRoom,
  useMakePick,
  type DraftPickSummary,
  type DraftRoomConnection,
} from '@/hooks/use-draft'
import { useNominate, usePlaceBid } from '@/hooks/use-draft-auction'
import { usePauseResumeDraft } from '@/hooks/use-draft-controls'
import {
  draftQueueKeys,
  useDraftQueue,
  useUpdateDraftQueue,
  type DraftQueueRow,
} from '@/hooks/use-draft-queue'
import { useLeague } from '@/hooks/use-league'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { useDeleteMockDraft } from '@/hooks/use-mock-drafts'
import { useMockRoomContext } from '@/hooks/use-mock-room'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { Draft } from '@/types/database'

import { AuctionBlock } from './auction-block'
import type { UncontestedBeat } from './auction-block-ops'
import { auctionKnobsOf, readLiveNomination, teamBudget } from './auction-budget'
import { AuctionPlayerTable } from './auction-player-table'
import { AvailablePlayers } from './available-players'
import { draftedIdSet } from './available-players-ops'
import { CommishDraftPanel } from './commish-draft-panel'
import { canUseCommishPanel } from './commish-panel-ops'
import { DraftCommandBar } from './draft-command-bar'
import { DraftDock } from './draft-dock'
import { type DraftOptionsSectionId } from './draft-options-ops'
import { DraftStatusStrip } from './draft-status-strip'
import { DraftBoardGrid } from './draft-board-grid'
import { DraftLobby } from './draft-lobby'
import { DraftChat } from './draft-chat'
import {
  abbreviateName,
  nextPickNumberForTeam,
  parseDraftOrder,
  pickLabel,
  recentPicks,
  type BoardModelInput,
} from './draft-board-ops'
import { DraftPick } from './draft-pick'
import type { OrderedDraftType } from './draft-order'
import { MockDraftLauncher } from './mock-draft-launcher'
import { MyListsPanel, type PoolOverlaySelection } from './my-lists-panel'
import { MyQueue } from './my-queue'
import { appendId, deriveQueueView, orderedIdsForSave } from './my-queue-ops'
import { MyRosterTracker } from './my-roster-tracker'
import { DraftPauseOverlay } from './pause-overlay'
import {
  FETCH_FAILED_BODY,
  FETCH_FAILED_TITLE,
  absentDraftIsHonest,
  queryHealth,
  worstHealth,
  type FetchHealth,
} from './room-health-ops'
import {
  PRACTICE_HOME_HREF,
  scopeFromLeague,
  scopeFromMock,
  type RoomScope,
} from './room-scope'
import { type PresenceSeat } from './presence-bar'
import { useSingleRoomTab } from './use-single-room-tab'

/** League statuses that can only be reached PAST a completed draft (§7.1) —
 *  the no-param room's recap-pointer arm (L.B3.5 2b). */
const POST_DRAFT_LEAGUE_STATUSES = new Set(['in_season', 'playoffs', 'complete'])

/** Every resolver state's way out (R340), from the room's scope — a league
 *  room says "Back to league", a standalone practice room "Back to practice
 *  drafts". No state builds a URL of its own. */
interface RoomExit {
  exitHref: string
  exitLabel: string
}

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
 * because DR.1 was already relocating the route).
 *
 * **Line numbers moved, and the first version of this paragraph claimed they
 * did not** (review finding R339). The `git mv` alone changed two identifier
 * lines — but this docblock was inserted above every landmark in the same
 * commit, so the file went 1013 → 1052 lines and **every
 * `snake-draft-room.tsx:NNN` citation surveyed against `main` @ 9c81f7c is
 * exactly 39 low**: `:389`→`:428` fork point, `:443`→`:482` `isCommish`,
 * `:450`→`:489` `canPauseResume`, `:666`→`:705` the `PageHeader` call,
 * `:719`→`:758` the status strip, `:768`→`:807` the 340px grid. §1 of
 * `tasks-DR-draft-room-redesign.md` and its DR.2–DR.7 banners are renumbered
 * against this file; §3's D-entries and §6's dispositions keep their
 * as-authored numbers (PROGRESS §4 quotes them verbatim) — add 39 there.
 *
 * DR.1 also moved the ROUTE into the `(room)` group, so this component now
 * renders inside a full-viewport, chrome-free frame with no app nav, header
 * or right rail (`src/app/app/(room)/layout.tsx`; spec §16.1 v2.12). Two
 * consequences a reader of this file needs:
 *   - **DR.2 (2026-08-18) deleted every `PageHeader` call this file carried**
 *     (they wrote into `useHeaderStore`, which only the shell's `AppHeader`
 *     reads — they rendered nothing here) and rehomed the live room's three
 *     occupants onto the 54px `DraftCommandBar` (spec §16.4 zone 1, D154):
 *     the commissioner door is the bar's **Draft Options**, opening the now
 *     trigger-less, controlled `CommishDraftPanel` (D153 — DR.3 swaps the
 *     door's target for the options menu); the launcher's **Pause practice**
 *     is the bar's mock pause/resume; **Exit room** is the bar's
 *     **Exit Draft**, for commissioner and member alike (Q13 — a plain
 *     in-place navigation; the heartbeat cleanup in `use-draft.ts` is the
 *     §8.5.5 away path, and `is_autodraft` is never touched). Measured, not
 *     asserted: with comments stripped, this file contains no PageHeader
 *     element and no app-header import — `draft-command-bar.test.ts` pins
 *     exactly that (this docblock deliberately never spells the JSX form,
 *     so the pin cannot be satisfied by prose).
 *   - **Every resolver state now offers an exit** (R340's enumeration,
 *     closed out by DR.2): **empty / problem / not-found / post-draft**
 *     carry an in-card *Back to league* from M2; the **lobby** and the
 *     **practice launcher** got theirs in DR.1's review fix (R340); the
 *     **skeleton** got one in DR.2 (the DR.7(5)/R348 deliberate call,
 *     recorded at PROGRESS D176 — in a chrome-free frame a hung fetch was a
 *     zero-affordance dead end); and the **live room**'s is the command
 *     bar's Exit Draft. Pinned in `room-exits.test.ts` and
 *     `draft-command-bar.test.ts`; per-variant DOM inventories are in the
 *     DR.2 PR. DR.7 owns the states sweep.
 *   - **DR.4 (2026-08-18) rebuilt the live room's body into §16.4's three
 *     zones**: the status Card became `draft-status-strip.tsx` (one
 *     `h-header` band under the bar — on-clock LEFT, clock RIGHT, D149) and
 *     the desktop `minmax(0,1fr)_340px` grid became a single full-width
 *     board zone that owns the room's only vertical scroll. The rail's five
 *     occupants — pool, queue (Targets), lists, tracker, chat — were PARKED
 *     for one task (DR.4's disclosed desktop gap).
 *   - **DR.5 (2026-08-18) closed that gap with the bottom dock**
 *     (`draft-dock.tsx`, spec §16.4's dock paragraph; D150/D151): a
 *     persistent tab strip at the room's bottom edge at EVERY width hosts
 *     all five panels — one open at a time, sliding up OVER the board at a
 *     fixed height, the board's geometry unchanged. The M2 mobile four-way
 *     Segment (and its `mobilePane` state) and the mobile lists bottom
 *     Sheet are DELETED — the dock supersedes both; the ticker + compact
 *     "my picks" rail survive as the mobile board-zone treatment, with the
 *     full grid one tap away via an in-zone disclosure (§16.4's density
 *     rule, unchanged). Pinned in `draft-dock.test.ts` and the rewritten
 *     dock-era pins of `draft-status-strip.test.ts`.
 *   - **DR.6 (2026-08-18) added the two-tabs guard** (`use-single-room-tab`,
 *     spec §9.3 v2.12 — RULED: newest tab wins): a released tab withholds
 *     the draft id from `useDraftRoom` (the channel + heartbeat tear down
 *     through that hook's own cleanups) and renders `DraftRoomTakenOver`,
 *     whose "Use this tab instead" re-claims. Per browser profile, never
 *     per user — a second device is left alone (D156).
 *   - **DR.7 (2026-08-18) is the one-voice sweep** (§16.3 say-a-thing-once;
 *     §16.5.4's v2.12 note; D154/D155): the pause overlay is VISUAL ONLY
 *     (dim + pointer-block — its copy and Resume button retired; the bar
 *     announces and acts), the `MockBanner` left the room (the bar's Mock
 *     badge is the one identity; the shell-side recap keeps its own), the
 *     reconnecting banner moved INTO the bar (same `connection` trigger),
 *     and the pre-start LOBBY mounts the same command bar ("Draft
 *     scheduled" + Exit Draft — its in-card exit and status badge retired
 *     into it). The one-state→one-site mapping is pinned in
 *     `one-voice.test.ts`.
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
 * Mobile (§16.4): the board zone collapses to a picks ticker + the "my
 * picks" rail with the full grid one tap away; the working panels are the
 * same bottom dock desktop uses (DR.5 — the Segment era ended there).
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

  const health = queryHealth({
    failureCount: detail.failureCount,
    isError: detail.isError,
    hasData: detail.data !== undefined,
  })
  // This mount's exit, once — every state below spreads it, so "Back to
  // league" is said in exactly one place in this file (MP.6c; the standalone
  // mount's equivalent is `PRACTICE_HOME_HREF`, in `room-scope.ts`).
  const leagueExit = {
    exitHref: `/app/leagues/${leagueId}`,
    exitLabel: 'Back to league',
  }

  // ----- resolution states the LEAGUE mount owns (§16.5.4) ----------------
  // Everything below this line needs a league and only a league: the D94
  // scheduled lobby, the §16.2 practice launcher, the post-draft recap
  // pointer, the league's own "no draft yet". They stay here rather than
  // travelling into the shared spine, because a room with no league has no
  // such states — it is not that they are hidden there, it is that the
  // objects they are about do not exist (§8.8, spec v2.16).

  if (detail.isPending) {
    return <DraftRoomSkeleton {...leagueExit} />
  }

  if (!detail.data) {
    // F56 rule 2: the error card is for holding NOTHING. With last-good
    // data cached, a failing refetch renders the room behind the §16.5.4
    // degraded banner instead of evicting a live draft room — "banner +
    // last-good data, never wrong numbers".
    return (
      <DraftRoomProblem
        {...leagueExit}
        title="Couldn't load this league."
        body="It may have been removed, or you no longer have access."
        onRetry={() => void detail.refetch()}
      />
    )
  }

  const scope = scopeFromLeague(leagueId, detail.data)

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
      //
      // **This branch is ahead of rule 1's gate on purpose** (R429 → D192;
      // `room-health-ops.ts` carries the reasoning). The lobby is the ONE
      // no-draft branch that mounts the command bar — §16.5.4 v2.12's single
      // banner surface — so a `degraded` fetch renders here as §16.5.4's
      // DEGRADED state (last-good data + banner), which is what the spec
      // requires of a data surface holding last-good data, rather than
      // evicting a scheduled lobby to an error card the way rule 1's first,
      // over-broad remedy did. `stale` IS that state and is live: past the
      // dataless `!detail.data` arm above, `health` here is exactly
      // `'ok' | 'degraded'`. Nothing is claimed silently — the banner reads
      // "Draft data isn't refreshing — showing the last state we read."
      return (
        <DraftLobby
          leagueId={leagueId}
          detail={detail.data}
          draft={null}
          myTeamId={myMemberTeamId}
          isCommish={canUseCommishPanel(detail.data.my_role)}
          stale={health === 'degraded'}
        />
      )
    }
    // F56 rule 1, at the branches that have NO banner to disclose with: an
    // absent draft is only HONEST when the fetch that failed to produce one
    // is healthy. Degraded/failed ⇒ the room says it could not read, and
    // offers the retry — it never guesses that there is nothing here (the
    // CLAUDE.md "nothing happened means it worked" shape this row is a
    // member of).
    if (!absentDraftIsHonest(health)) {
      return (
        <DraftRoomProblem
          {...leagueExit}
          title={FETCH_FAILED_TITLE}
          body={FETCH_FAILED_BODY}
          onRetry={() => void detail.refetch()}
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
                  <Link href={leagueExit.exitHref}>{leagueExit.exitLabel}</Link>
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
        {...leagueExit}
        title="No draft yet"
        body="This league hasn’t scheduled its draft. The commissioner can schedule it from the league home."
      />
    )
  }

  return (
    <DraftRoomResolved
      scope={scope}
      draftId={draftId}
      myMemberTeamId={myMemberTeamId}
      userId={user?.id ?? null}
      contextHealth={health}
      onRetryContext={() => void detail.refetch()}
      renderScheduled={(draft, onlineTeamIds) => (
        <DraftLobby
          leagueId={leagueId}
          detail={detail.data!}
          draft={draft}
          onlineTeamIds={onlineTeamIds}
          myTeamId={myMemberTeamId}
          isCommish={canUseCommishPanel(detail.data!.my_role)}
          stale={health === 'degraded'}
        />
      )}
    />
  )
}

interface MockDraftRoomProps {
  /** `/app/mocks/[mockId]` — the mock IS the draft (MP.6/D244). */
  mockId: string
}

/**
 * **THE STANDALONE PRACTICE ROOM'S MOUNT** — MP task MP.6c (spec v2.16
 * §8.8: *practice is the purpose, a league is optional context*).
 *
 * The second fill site of `room-scope.ts` and nothing else. It is NOT a
 * second room: it resolves the same `RoomScope` the league mount resolves —
 * seats, roster, scoring family, exits — from the practice draft itself, and
 * hands it to the SAME `DraftRoomResolved` spine and the SAME
 * `DraftRoomLive` below. A second room component is the LV.7 failure
 * pattern, and this task is where that temptation was strongest.
 *
 * Its own three states (MP.6c item 8), each named rather than inferred:
 *  - **loading** — the shared skeleton, with an exit (the `(room)` frame is
 *    chrome-free, so a hung fetch with no link is the R340 dead end);
 *  - **a dead mock id** — the honest not-found with a route back to
 *    `/app/mocks`, never a 404 dead end (R515);
 *  - **someone else's mock id** — the SAME state, by construction: 095's
 *    standalone SELECT arm is keyed on the launcher, so RLS answers the
 *    empty result for both and this page cannot tell them apart. It never
 *    says "not yours", because saying that would confirm the row exists.
 */
export function MockDraftRoom({ mockId }: MockDraftRoomProps) {
  const { user } = useAuth()
  const context = useMockRoomContext(mockId)

  // This mount's exit, once — the mirror of the league mount's `leagueExit`.
  const practiceExit = { exitHref: PRACTICE_HOME_HREF, exitLabel: 'Back to practice drafts' }

  const health = queryHealth({
    failureCount: context.failureCount,
    isError: context.isError,
    hasData: context.data !== undefined,
  })

  if (context.isPending) {
    return <DraftRoomSkeleton {...practiceExit} />
  }

  if (context.isError) {
    return (
      <DraftRoomProblem
        {...practiceExit}
        title="Couldn't load this practice draft."
        body={FETCH_FAILED_BODY}
        onRetry={() => void context.refetch()}
      />
    )
  }

  if (context.data === null) {
    return (
      <DraftRoomEmpty
        {...practiceExit}
        title="This practice draft isn’t here"
        body="It may have been deleted, or expired after 72 hours paused."
      />
    )
  }

  return (
    <DraftRoomResolved
      scope={scopeFromMock(context.data)}
      draftId={mockId}
      // The one human seat, so §9.3 presence has something honest to
      // announce (the CPUs are never "online" — they are not users).
      myMemberTeamId={context.data.humanTeamId}
      userId={user?.id ?? null}
      contextHealth={health}
      onRetryContext={() => void context.refetch()}
      renderScheduled={() => (
        // Unreachable on today's engine and rendered anyway rather than
        // crashed through: `create_mock_draft` INSERTs `status 'live'` in
        // the launch transaction (`095_standalone_mock.sql:1174-1183` —
        // "Starts immediately (§8.8)"), so a standalone mock is never
        // `scheduled`. If that ever changes, this says what is true instead
        // of borrowing the league lobby, which is a surface about a league.
        <DraftRoomEmpty
          {...practiceExit}
          title="This practice draft hasn’t started"
          body="Start a new one from your practice drafts."
        />
      )}
    />
  )
}

interface DraftRoomResolvedProps {
  /** The room's non-draft context — filled by the MOUNT (D229(5)/§4 rule
   *  12), never read from a league or a config in here. */
  scope: RoomScope
  draftId: string
  /** The viewer's league seat, or null (a mock resolves its own "You" seat
   *  from `config.mock` inside the live room — D103(2)). */
  myMemberTeamId: string | null
  userId: string | null
  /** Fetch health of the SCOPE's own source, merged with the room query's
   *  below — F56's rule applies to whichever read failed. */
  contextHealth: FetchHealth
  onRetryContext: () => void
  /** The pre-start state, which is a LEAGUE object (the D94 lobby) — so the
   *  mount owns it. See each mount's renderer. */
  renderScheduled: (draft: Draft, onlineTeamIds: ReadonlySet<string>) => ReactNode
}

/**
 * The room's SPINE — the draft-keyed half, shared by both mounts and league-
 * optional throughout (MP.6c item 1: ONE component, widened, never forked).
 *
 * Everything here keys on the DRAFT: the §9.3 single-tab guard, the one
 * channel, the §16.5.4 resolution states, the completion beat and the live
 * room. The only thing it knows about a league is `scope.leagueId`, and
 * `null` is a legal value of it.
 */
function DraftRoomResolved({
  scope,
  draftId,
  myMemberTeamId,
  userId,
  contextHealth,
  onRetryContext,
  renderScheduled,
}: DraftRoomResolvedProps) {
  // The two-tabs guard (DR.6; D156; spec §9.3 v2.12 — RULED: newest tab
  // wins). A released tab passes NO draft id into the room spine below, so
  // `useDraftRoom`'s own effect cleanups do the release — the §9.3 channel
  // teardown unsubscribes `draft:<id>` and the heartbeat effect's cleanup
  // stops `draft_touch`. No second mechanism; the guard only withholds the
  // id. Pinned in single-room-tab.test.ts.
  const guard = useSingleRoomTab(draftId)
  const heldDraftId = guard.role === 'released' ? undefined : draftId

  const room = useDraftRoom(heldDraftId, {
    presence: { team_id: myMemberTeamId, user_id: userId },
  })

  // ----- fetch-path honesty (L.C3.1, PROGRESS F56's room half) ------------
  // F56 watched a LIVE manager room fall back to the scheduled-lobby
  // surface — "the settings-countdown branch renders when the room's draft
  // data is absent". That branch is honest for ONE reason (a scheduled
  // league whose drafts row the tick hasn't created — D94) and a lie for
  // every other reason the data can be absent, and the room could not tell
  // them apart. `room-health-ops.ts` carries the decision and the N-failure
  // threshold (the SAME constant the subscribe path's R263 banner uses);
  // here it does two things: it feeds the bar's §16.5.4 degraded banner so a
  // room drawn from last-good data says so instead of looking current, and
  // it gates the no-draft branches that have NO banner to say it with.
  const health = worstHealth(
    contextHealth,
    queryHealth({
      failureCount: room.failureCount,
      isError: room.isError,
      hasData: room.data !== undefined,
    }),
  )
  const retryRoom = () => {
    onRetryContext()
    void room.refetch()
  }

  // ----- resolution states (§16.5.4: skeleton / error / honest empties) ----

  // Released FIRST: a taken-over tab renders the §9.3 takeover state and
  // nothing else (its room query is idle, so every later arm would misread
  // it as loading). The takeover state carries its own exit (room-exits
  // pin) plus "Use this tab instead", which re-claims — and the then-older
  // tab releases in turn.
  if (guard.role === 'released') {
    return (
      <DraftRoomTakenOver
        exitHref={scope.exitHref}
        exitLabel={scope.exitLabel}
        onReclaim={guard.reclaim}
      />
    )
  }

  if (room.isPending) {
    return <DraftRoomSkeleton exitHref={scope.exitHref} exitLabel={scope.exitLabel} />
  }

  if (room.isError && room.data === undefined) {
    // As above (F56 rule 2): errors with NOTHING cached get the card; errors
    // over last-good data get the banner and keep the room.
    return (
      <DraftRoomProblem
        exitHref={scope.exitHref}
        exitLabel={scope.exitLabel}
        title="Couldn't load the draft."
        body="The room state didn't come back. Retry, or head back."
        onRetry={() => void room.refetch()}
      />
    )
  }

  const draft = room.data?.draft ?? null

  // MP.6c item 3 — R470's class, with the mock arm. The guard is unchanged
  // in shape and now TRUE for both rooms: a league room requires the draft
  // to belong to THIS league, and a standalone room requires it to belong to
  // no league at all (`scope.leagueId` is null, `draft.league_id` is null).
  // A league-attached draft opened at `/app/mocks/[mockId]` therefore lands
  // in the same honest not-found — and the route redirects it to the room it
  // has before this is reached (R521).
  if (!draft || draft.league_id !== scope.leagueId) {
    if (!absentDraftIsHonest(health)) {
      // Same rule as the league mount's no-draft arm: "Draft not found" is a
      // claim about the world, and a failing fetch has not earned it.
      return (
        <DraftRoomProblem
          exitHref={scope.exitHref}
          exitLabel={scope.exitLabel}
          title={FETCH_FAILED_TITLE}
          body={FETCH_FAILED_BODY}
          onRetry={retryRoom}
        />
      )
    }
    // RLS returned no row (not a member / not the launcher / unknown id) or
    // the id belongs somewhere else — one indistinguishable honest state, no
    // leak.
    return (
      <DraftRoomEmpty
        exitHref={scope.exitHref}
        exitLabel={scope.exitLabel}
        title="Draft not found"
        body="There's no draft here by that id."
      />
    )
  }

  if (draft.status === 'scheduled') {
    // L.B3.4: the pre-start room state IS the lobby (§8.5.1/§16.5.2). The
    // room's ONE channel is already open (useDraftRoom subscribed after the
    // fetch), so presence works here and the start flip arrives as the
    // drafts UPDATE broadcast — the lobby becomes the live room in place.
    // The surface itself is the MOUNT's (a lobby is a league object).
    return <>{renderScheduled(draft, room.onlineTeamIds)}</>
  }

  if (draft.status === 'complete') {
    // The completion moment (§16.5.2's draft-night row ends at the recap):
    // when the final pick's broadcast flips `status` to complete, this
    // branch renders IN PLACE — the room's own "view the recap" beat.
    //
    // MP.6c item 8: a completed STANDALONE mock has no recap route to point
    // at — `/app/mocks/[mockId]/report` is MP.8's and does not exist yet, so
    // this states the finish plainly and routes to the practice home rather
    // than borrowing the league-shaped recap link (which would 404). The
    // report control on `/app/mocks` is disabled for the same reason, with
    // its reason printed (R515) — one story in both places.
    const standalone = scope.leagueId === null
    return (
      <div className="flex flex-col gap-4">
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
              {!standalone && (
                <Button variant="blue" size="sm" shadow asChild>
                  <Link href={`/app/leagues/${scope.leagueId}/draft/recap?draft=${draft.id}`}>
                    View the recap
                  </Link>
                </Button>
              )}
              <Button variant={standalone ? 'blue' : 'stroke'} size="sm" shadow={standalone} asChild>
                <Link href={scope.exitHref}>{scope.exitLabel}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <DraftRoomLive
      scope={scope}
      draft={draft}
      picks={room.data?.picks ?? []}
      connection={room.connection}
      offsetMs={room.offsetMs}
      uncontestedBeat={room.uncontestedBeat}
      onlineTeamIds={room.onlineTeamIds}
      myMemberTeamId={myMemberTeamId}
      userId={userId}
      stale={health === 'degraded'}
    />
  )
}

// ---------------------------------------------------------------------------
// The live room (status live | paused)
// ---------------------------------------------------------------------------

interface DraftRoomLiveProps {
  /** The room's non-draft context (MP.6c item 2). A LEAGUE room's is filled
   *  from `LeagueDetail`, a standalone practice room's from the draft
   *  itself — and this component cannot tell which, deliberately. */
  scope: RoomScope
  draft: Draft
  picks: DraftPickSummary[]
  connection: DraftRoomConnection
  offsetMs: number
  /** §8.6.9's room beat, latched at the payload by `useDraftRoom` (AP.2).
   *  The award is already committed when this arrives — the room only says
   *  so, for 3 seconds, in the gap before the next nomination (§16.5.4). */
  uncontestedBeat: UncontestedBeat | null
  onlineTeamIds: ReadonlySet<string>
  myMemberTeamId: string | null
  userId: string | null
  /** The room's fetch health is DEGRADED (F56's room half) — the bar
   *  carries §16.5.4's banner over last-good data. */
  stale: boolean
}

function DraftRoomLive({
  scope,
  draft,
  picks,
  connection,
  offsetMs,
  uncontestedBeat,
  onlineTeamIds,
  myMemberTeamId,
  userId,
  stale,
}: DraftRoomLiveProps) {
  // §8.9 (L.B4.2): the pool-overlay selection (room-owned so panel and pool
  // can never disagree) and the room-level Add-a-draft-list modal, mounted
  // OUTSIDE every overlay (D119(6)). The M2 mobile pane switcher and its
  // lists bottom Sheet died here (DR.5): the dock hosts all five panels at
  // every width, and its own open/closed state lives inside `DraftDock`.
  const [overlay, setOverlay] = useState<PoolOverlaySelection | null>(null)
  const [addListOpen, setAddListOpen] = useState(false)
  // §16.4's mobile board-zone rule, unchanged by the reconciliation: the
  // full grid stays ONE TAP away (it was the Segment's "Full board" pane;
  // the dock's five tabs are the five panels, so the tap lives in the
  // board zone itself as a disclosure).
  const [mobileBoardOpen, setMobileBoardOpen] = useState(false)
  // DR.2/DR.3 (D153): the §8.7 panel is trigger-less and controlled — the
  // command bar's Draft Options MENU is its one door. Choosing a group
  // stores the target section and opens the panel there; closing clears the
  // section so every opening is an explicit "open AT" (a reopen without a
  // choice starts at the top, like any sheet).
  const [draftOptionsOpen, setDraftOptionsOpen] = useState(false)
  const [draftOptionsSection, setDraftOptionsSection] = useState<DraftOptionsSectionId | null>(
    null,
  )
  const openDraftOptionsAt = (section: DraftOptionsSectionId) => {
    setDraftOptionsSection(section)
    setDraftOptionsOpen(true)
  }
  const router = useRouter()
  const queryClient = useQueryClient()

  // The add-list modal's Attached flags: MY attached list ids (fetched only
  // once the modal opens; shares the panel's query cache).
  const leagueListRows = useLeagueLists(scope.leagueId ?? undefined, addListOpen)
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
    () => new Map(scope.teams.map((t) => [t.id, t])),
    [scope.teams],
  )
  const teamNameById = useMemo(
    () => new Map(scope.teams.map((t) => [t.id, t.name])),
    [scope.teams],
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

  // The live nomination (D126 — phase is `current_nomination`'s NULLity),
  // read here because the identity fetch below needs the nominated player.
  const liveNomination = useMemo(
    () => readLiveNomination(draft.current_nomination),
    [draft.current_nomination],
  )
  // The player the nominator chose out of the pool, awaiting an opening bid.
  // Room-owned (the L.B4.2 overlay precedent) so the dock's Players panel
  // and the board-zone block can never disagree about what is being
  // nominated. Cleared the moment a nomination actually opens — the server's
  // `current_nomination` is then the truth (§8.1/§15.6: intent optimistic,
  // RESULT authoritative; nothing here is written optimistically).
  const [nomineeId, setNomineeId] = useState<string | null>(null)

  // ONE identity read for every picked player (world-readable `players` —
  // D92 read pattern); board cells + ticker + tracker all key into it.
  // Broadcast hint rows render a placeholder until the keyed refetch lands.
  // The auction adds two ids to the SAME read rather than minting a second
  // fetch: the live nominee and the player this seat is about to nominate.
  const { playerById } = usePlayersByIds(
    useMemo(() => {
      const ids = livePicks.map((p) => p.player_id)
      if (liveNomination) ids.push(liveNomination.player_id)
      if (nomineeId) ids.push(nomineeId)
      return ids
    }, [livePicks, liveNomination, nomineeId]),
  )

  // ===== THE D135 FORK POINT ==============================================
  // One shell, two centre stages (D135: "one shell + an auction center
  // stage; the fixture room dies"). `auction` renders `auction-block.tsx`
  // in the board zone instead of the pick grid; the command bar, status
  // strip, bottom dock, commissioner door and lobby/complete/error states
  // are shared verbatim — an auction draft is not a different room, it is a
  // different board. The M0-era `auction-draft-room.tsx` fixture and its
  // `mock-draft.ts` types were DELETED in this task, per D135 and that
  // file's own banner.
  const isAuction = draft.draft_type === 'auction'
  // Board geometry (D90): columns from the stored order. `OrderedDraftType`
  // has no auction member on purpose (`draft-order.ts`: "auction has no
  // board order — callers never ask"), so an auction draft coerces to
  // 'snake' here.
  //
  // **Every consumer of that coercion is auction-gated, and the first cut of
  // this comment was wrong to say the value is "simply unused"** (review
  // finding R427). It has two consumers: `boardInput`, which only
  // `<DraftBoardGrid>` reads and the auction branch never renders — and
  // `myNextPick`, which fed the SHARED status strip and so DID reach the
  // auction room, printing a snake board coordinate ("Your next: 1.06") in a
  // room that has no board. §16.4 zone 2 lists the strip's contents —
  // LIVE/PAUSED, Round & Pick, draft order, presence, clock — and "your next
  // pick" is not among them; §16.4's auction-room callout puts per-team
  // standing in the team columns instead. `myNextPick` is therefore null on
  // the auction path (below), which is what makes this coercion genuinely
  // unreachable there.
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
    for (const member of scope.members) {
      if (member.team_id && (member.is_autodraft === true || !member.user_id)) {
        ids.add(member.team_id)
      }
    }
    return ids
  }, [draft.is_mock, scope.members])

  const seatIds = order.length > 0 ? order : scope.teams.map((t) => t.id)
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
  const isCommish = canUseCommishPanel(scope.myRole) && !draft.is_mock
  const pauseResume = usePauseResumeDraft(scope.leagueId, draft.id)
  // DR.2: one pause/resume handler for the bar — the SHIPPED
  // usePauseResumeDraft mutation, no new route (DR.2 item 5). The bar is
  // the ONE pause/resume site since DR.7/D155 retired the overlay's Resume
  // button; who may call it (commissioner on a real draft, the LAUNCHER on
  // a mock — R272, 069/071's mock-launcher arm) is derived inside
  // `command-bar-ops.ts` from the raw inputs the bar mount passes below.
  const handlePauseResume = (action: 'pause' | 'resume') => {
    pauseResume.mutateAsync({ action }).catch((error: unknown) => {
      toast({
        title: action === 'pause' ? 'Pause failed' : 'Resume failed',
        description:
          error instanceof LeagueActionError
            ? error.message
            : 'Something went wrong. The room refreshes automatically.',
        variant: 'destructive',
      })
    })
  }
  // The bar's reduced Practice-options menu (D154): delete-and-exit through
  // the SHIPPED delete verb (071's `delete_mock_draft` refuses everyone but
  // the launcher in-RPC — same door the launcher's MockRow uses).
  const deleteMock = useDeleteMockDraft(scope.leagueId)
  const handleDeletePractice = () => {
    deleteMock
      .mutateAsync(draft.id)
      .then(() => {
        toast({ title: 'Practice draft deleted' })
        router.push(scope.exitHref)
      })
      .catch((error: unknown) => {
        toast({
          title: "Couldn't delete the practice draft",
          description:
            error instanceof LeagueActionError ? error.message : 'Something went wrong.',
          variant: 'destructive',
        })
      })
  }
  // R427: the auction has NO board coordinate to offer. `nextPickNumberForTeam`
  // walks pure snake/linear board geometry, while the auction rotation skips
  // teams whose rosters are already full (§8.6.7(c)/E27) — the walk coincides
  // with the nomination order in lap 1 and diverges permanently after, so the
  // hint is not merely off-contract, it goes WRONG. Suppressed at the source
  // rather than at the strip so the coercion above reaches nothing on the
  // auction path.
  const myNextPick = useMemo(
    () =>
      isAuction
        ? null
        : nextPickNumberForTeam(
            order,
            draftType,
            snakeReversal,
            draft.current_pick_number,
            draft.total_rounds,
            myTeamId,
          ),
    [
      isAuction,
      order,
      draftType,
      snakeReversal,
      draft.current_pick_number,
      draft.total_rounds,
      myTeamId,
    ],
  )

  // ----- pick submission (L.B2.2's route/hook, wired here — D92) -----------
  // NEVER optimistic (§15.6): the button shows "submitting…" (§16.3) and the
  // board reflects the broadcast/refetch; the E1 race loser's friendly
  // message surfaces verbatim.
  const makePick = useMakePick(scope.leagueId, draft.id)
  const canDraft = !isAuction && youAreOnClock && draft.status === 'live'
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

  // ----- auction verbs (L.C2.1's routes/hooks, wired here — D92/D189) -----
  // Same posture as `makePick`: NEVER optimistic (§15.6) — the hooks touch
  // no cache on mutate and open no channel; the button says "submitting…"
  // (§16.3) and the room repaints off the `drafts`/`draft_bids` broadcast.
  // The RPC's product copy — "outbid at $2 — … bid $3 or more", "just went
  // off the board", the E5 ceiling with the server's own numbers — is
  // surfaced VERBATIM (D189(3): callers never paraphrase it).
  const nominate = useNominate(scope.leagueId, draft.id)
  const placeBid = usePlaceBid(scope.leagueId, draft.id)
  const auctionSubmitting = nominate.isPending || placeBid.isPending
  const auctionFailureToast = (title: string) => (error: unknown) => {
    toast({
      title,
      description:
        error instanceof LeagueActionError
          ? error.message
          : 'Something went wrong. The room refreshes automatically.',
      variant: 'destructive',
    })
  }
  const handleNominate = (playerId: string, openingBid: number) => {
    if (auctionSubmitting) return
    nominate
      .nominateAsync(playerId, openingBid)
      .then(() => setNomineeId(null))
      .catch(auctionFailureToast('Nomination not made'))
  }
  const handleBid = (amount: number) => {
    if (auctionSubmitting) return
    if (!liveNomination || draft.current_pick_number === null) return
    placeBid
      .placeBidAsync({
        // F64: a bid ALWAYS names the nomination it was placed on — the
        // sequence number and player THIS ROOM is looking at. A stale pair
        // is refused server-side with §16.3's went-off-the-board copy.
        nominationSeq: draft.current_pick_number,
        playerId: liveNomination.player_id,
        amount,
      })
      .catch(auctionFailureToast('Bid not placed'))
  }

  // ----- queue (own rows; a mock's launcher drives the human seat — D103(3))
  const queueTeamId = myTeamId
  const queue = useDraftQueue(draft.id, queueTeamId ?? undefined)
  const updateQueue = useUpdateDraftQueue(scope.leagueId, draft.id, queueTeamId ?? '')
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

  // L.C3.2 item 3: MY auction budget for the roster tracker's needs line —
  // the §4.7 display-only mirror of 084 (`auction-budget.ts`), the same
  // derivation the board's team columns render. Null on a snake draft and
  // for a seatless viewer.
  const myBudget = useMemo(() => {
    if (!isAuction || !myTeamId) return null
    const knobs = auctionKnobsOf(draft.config)
    return teamBudget(
      {
        auctionBudget: knobs.auctionBudget,
        reserve: knobs.reserve,
        totalRounds: draft.total_rounds,
        budgetAdjustments: draft.budget_adjustments,
      },
      picks,
      myTeamId,
    )
  }, [isAuction, myTeamId, draft.config, draft.total_rounds, draft.budget_adjustments, picks])

  const ticker = useMemo(() => recentPicks(livePicks, 6), [livePicks])
  const teamCount = seatIds.length

  // In an auction the pool's primary row action is NOMINATE, not Draft —
  // the same component with a different verb (CLAUDE.md: add a prop, never
  // fork a near-duplicate). It SELECTS the player into the board zone's
  // nomination composer rather than writing: the opening bid is part of the
  // action (§8.6.2), and it is capped by max bid, so the amount has to be
  // chosen before anything is sent. Offered only to the seat on the clock
  // in the nominating phase — exactly when `draft_nominate` would accept it.
  const canNominate =
    isAuction && youAreOnClock && draft.status === 'live' && liveNomination === null
  const poolCard = (
    <AvailablePlayers
      draftedIds={draftedIds}
      queuedIds={queuedIds}
      userId={userId ?? undefined}
      canDraft={canDraft || canNominate}
      primaryActionLabel={isAuction ? 'Nominate' : undefined}
      draftSubmitting={isAuction ? auctionSubmitting : makePick.isPending}
      canQueue={Boolean(queueTeamId)}
      onDraft={isAuction ? setNomineeId : handleDraft}
      onQueue={handleQueue}
      overlay={overlay}
      onClearOverlay={() => setOverlay(null)}
    />
  )

  // L.C3.3: in an AUCTION the dock's Players panel is §16.2's
  // `auction-player-table` instead — Chris's v2.10 requirement (§16.4's
  // player-table callout: projections, $-per-point, splits, filters,
  // column customization, the three row actions) is a strict SUPERSET of
  // what the pool card offers an auction, so hosting both in one panel
  // would be two lists of the same players. The table keeps every filter
  // and both actions the pool had, including the §8.9 overlay, and the
  // Nominate verb still SELECTS into the block's composer (the write is
  // `useNominate`, never optimistic — §15.6). `poolCard` stays the panel
  // for every other draft type, unchanged.
  const playersCard = isAuction ? (
    <AuctionPlayerTable
      leagueId={scope.leagueId}
      scoringSystemId={scope.scoringSystemId}
      draftId={draft.id}
      userId={userId ?? undefined}
      picks={picks}
      teamNameById={teamNameById}
      queuedIds={queuedIds}
      onQueue={handleQueue}
      canNominate={canNominate}
      onNominate={setNomineeId}
      submitting={auctionSubmitting}
      regularSeasonWeeks={scope.regularSeasonWeeks}
      overlay={overlay}
      onClearOverlay={() => setOverlay(null)}
    />
  ) : (
    poolCard
  )

  // The dock renders every tab for every seat (DR.5: it is not
  // commissioner chrome), so the seat-gated panels carry the §16.5.4
  // honest no-seat copy instead of vanishing.
  const queueCard = queueTeamId ? (
    <MyQueue
      leagueId={scope.leagueId}
      draftId={draft.id}
      teamId={queueTeamId}
      draftedIds={draftedIds}
    />
  ) : (
    <p className="text-[12px] font-medium text-n-3">
      {draft.is_mock
        ? 'Only the mock’s launcher drives practice Targets.'
        : 'You don’t hold a seat in this draft, so there are no Targets to build.'}
    </p>
  )

  const trackerCard = myTeamId ? (
    <MyRosterTracker
      picks={myPicks}
      playerById={playerById}
      roster={scope.roster}
      // L.C3.2 item 3: on an auction the needs line carries what the needs
      // COST — remaining budget and max bid, off the same parity-pinned
      // mirror the board's team columns use (§8.6.1).
      budget={isAuction ? (myBudget ?? null) : null}
    />
  ) : (
    <p className="text-[12px] font-medium text-n-3">
      {draft.is_mock
        ? 'Only the mock’s launcher holds a practice roster.'
        : 'You don’t hold a seat in this draft, so there’s no roster to track.'}
    </p>
  )

  // §16.2 my-lists-panel (§8.9), hosted by the dock's Lists tab at every
  // width. The cheat sheet stays the INLINE drill-in (the shipped mobile
  // variant): the dock is non-modal (D150), and opening the side-Sheet
  // variant's Radix focus trap from inside it would make the board inert —
  // the exact property D150 exists to protect. `onAddList` opens the
  // room-level modal DIRECTLY and the dock stays open behind it: D119(6)'s
  // close-first step was instrumental (a Dialog opened from inside a Radix
  // Sheet registers as an outside interaction, closing the Sheet and
  // taking the child dialog with it); the dock has no outside-interaction
  // dismissal and no focus scope, so there is nothing for the Dialog to
  // collapse — what D119(6) still requires, and keeps, is the modal
  // mounted at room level OUTSIDE every overlay.
  const listsCard = (
    <MyListsPanel
      leagueId={scope.leagueId}
      draftId={draft.id}
      members={scope.members}
      userId={userId}
      queueTeamId={queueTeamId}
      draftedIds={draftedIds}
      canDraft={canDraft || canNominate}
      primaryActionLabel={isAuction ? 'Nominate' : undefined}
      draftSubmitting={isAuction ? auctionSubmitting : makePick.isPending}
      onDraft={isAuction ? setNomineeId : handleDraft}
      onQueue={handleQueue}
      overlay={overlay}
      onOverlayChange={setOverlay}
      // §8.9's Add-a-draft-list attaches a list to a LEAGUE, so a standalone
      // practice room does not offer it (F122: the panel offers what the
      // verb accepts — the caller's OWN lists — and nothing else).
      onAddList={scope.leagueId === null ? null : () => setAddListOpen(true)}
      inlineCheatSheet
    />
  )

  const chatCard = (
    <DraftChat scope={scope} draftId={draft.id} userId={userId} />
  )

  // The auction's board (D135's "auction center stage"): §16.2's
  // `auction-block` — nomination centrepiece + the §16.4 per-team columns —
  // composed INSIDE the full-width board zone, because DR.4 deleted the
  // side rail this banner's original text called a "budgets rail".
  const auctionCard = isAuction ? (
    <AuctionBlock
      draft={{
        id: draft.id,
        status: draft.status,
        config: draft.config,
        total_rounds: draft.total_rounds,
        current_pick_number: draft.current_pick_number,
        current_deadline: draft.current_deadline,
        on_clock_team_id: draft.on_clock_team_id,
        current_nomination: draft.current_nomination,
        budget_adjustments: draft.budget_adjustments,
        nomination_order: draft.nomination_order,
      }}
      teams={scope.teams}
      picks={picks}
      playerById={playerById}
      roster={scope.roster}
      myTeamId={myTeamId}
      offsetMs={offsetMs}
      uncontestedBeat={uncontestedBeat}
      nomineeId={nomineeId}
      onClearNominee={() => setNomineeId(null)}
      onNominate={handleNominate}
      onBid={handleBid}
      submitting={auctionSubmitting}
    />
  ) : null

  const boardCard = (
    // Relative host for the paused board treatment — VISUAL ONLY since
    // DR.7 (D155): it dims the board and blocks its pointer events while
    // the chrome and the dock stay usable. Everything it used to SAY —
    // status words, frozen clock, Resume — is said once, elsewhere (see
    // pause-overlay.tsx's docblock and one-voice.test.ts).
    <div className="relative min-w-0">
      {paused && <DraftPauseOverlay />}
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
    // DR.4: the live room is a fixed column of three zones (spec §16.4;
    // D149) — command bar, status strip, board. `h-full` + `overflow-hidden`
    // size this root to exactly the (room) frame's height, so the frame's
    // own wrapper can never overflow while the live room is mounted and the
    // ONE scrollable region in the live room is the board zone below.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* DR.2: the room's own top chrome, every width (spec §16.4 zone 1;
          D149's first band). The variant/control derivation lives in
          `command-bar-ops.ts` (D154), where the D110(1) mock mask is
          re-applied. The launcher's old header "Pause practice" button and
          the old "Exit room" ghost link both live here now. */}
      <DraftCommandBar
        exitHref={scope.exitHref}
        bar={{
          commishRole: canUseCommishPanel(scope.myRole),
          isMock: draft.is_mock,
          isMockLauncher,
          paused,
          // DR.7(3): the §16.5.4 reconnecting state renders IN the bar —
          // same trigger the M2 board-zone banner used, one strip not a
          // stack. The hook's refetch-then-resubscribe behavior (§9.3) is
          // untouched; this only moves where the state is TOLD.
          reconnecting: connection === 'reconnecting',
          // F56's room half: the FETCH path's banner shares the bar with
          // the SUBSCRIBE path's, because the bar is the room's one banner
          // surface (§16.5.4 v2.12). They are different states and can
          // legitimately show together.
          stale,
        }}
        hasSeat={Boolean(myTeamId)}
        // L.C3.2: the `Draft Options` catalog is per draft type — an auction
        // room lists Manual Edit Mode, Edit current nomination, Team budgets
        // and End draft; a snake room lists none of them.
        isAuction={isAuction}
        pausePending={pauseResume.isPending}
        onPauseResume={handlePauseResume}
        onOpenDraftOptions={openDraftOptionsAt}
        onDeletePractice={handleDeletePractice}
        deletePending={deleteMock.isPending}
      />

      {/* DR.4 (D149's second band): the status strip, DIRECTLY under the
          bar — on-clock line at the LEFT edge, clock at the RIGHT
          (requirement 3); presence/draft order in the flexible middle. This
          replaces the status Card, which put on-clock beside the clock and
          presence on a second row. */}
      <DraftStatusStrip
        strip={{
          paused,
          round: draft.current_round,
          pickNumber: draft.current_pick_number,
          youAreOnClock,
          onClockTeamName: onClockTeam?.name ?? null,
          myNextPickLabel: myNextPick !== null ? pickLabel(myNextPick, teamCount) : null,
        }}
        seats={seats}
        clock={{
          status: draft.status,
          current_deadline: draft.current_deadline,
          deadline_remaining_ms: draft.deadline_remaining_ms,
        }}
        offsetMs={offsetMs}
      />

      {/* The board zone (§16.4 zone 3) — the room's ONLY vertical scroll
          (DR.4). DR.7 evicted its two interim banner tenants: the MOCK
          identity is the bar's badge (D154) and the reconnecting state is
          the bar's strip (§16.5.4 v2.12) — the zone now hosts draft
          surfaces and nothing else. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-4">
        {isAuction ? (
          // The auction stage is ONE composition at every width — it carries
          // its own §16.4 mobile density treatment inside (my column
          // resident, the rest one tap away), so there is no desktop/mobile
          // split here the way the pick grid needs one. The paused dim wraps
          // it exactly as it wraps the grid (D155: visual only — the bar
          // says "Draft paused", this makes the board look inert).
          <div className="relative min-w-0">
            {paused && <DraftPauseOverlay />}
            {auctionCard}
          </div>
        ) : (
          <>
        {/* ----- Desktop (lg+): the FULL-WIDTH board (requirement 1 — the
              340px rail is deleted). The rail's five former occupants —
              pool, queue, lists, tracker, chat — live in the bottom dock
              below the board zone (DR.5 closed DR.4's disclosed gap). ----- */}
        <div className="hidden min-w-0 lg:block">{boardCard}</div>

        {/* ----- Mobile (§16.4): ticker + my-picks rail SURVIVE as the
              board-zone density treatment; the four-way Segment is GONE —
              the dock is the one pattern on both platforms (DR.5, v2.12
              reconciliation) — and the full grid stays one tap away via
              the disclosure below.

              The paused DIM does not extend over this resident mobile zone,
              DELIBERATELY (R397, decided in DR.8 — PROGRESS D183): the
              dim's job is to make an INTERACTIVE board visibly inert, and
              the resident mobile surfaces are read-only content — the
              ticker and the compact tracker take no draft action, and the
              overlay's pointer-event blocking would break the ticker's
              horizontal scroll (reviewing recent picks is what a pause is
              FOR). Paused still reads at this width without it: the bar's
              status line, the strip's PAUSED badge and the clock's paused
              mode all render below `lg`, and the ticker's on-clock cell is
              `!paused`-gated below — the zone visibly stops advancing. The
              one interactive board surface mobile can summon — the full
              grid via the disclosure — mounts `boardCard`, which CARRIES
              the dim (measured in the DR.8 states sweep at 375: summoned
              grid dimmed, ticker scrollable). ----- */}
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
                  roster={scope.roster}
                  budget={isAuction ? (myBudget ?? null) : null}
                />
              </CardContent>
            </Card>
          )}

          {/* §16.4's "full grid one tap away", with the Segment gone: a
              board-zone disclosure. The grid is summoned, not resident —
              20 columns at 20 teams is the density rule's whole reason. */}
          <Button
            variant="stroke"
            size="sm"
            className="w-fit"
            aria-expanded={mobileBoardOpen}
            onClick={() => setMobileBoardOpen((current) => !current)}
          >
            {mobileBoardOpen ? 'Hide full board' : 'Show full board'}
          </Button>
          {mobileBoardOpen && boardCard}
        </div>
          </>
        )}
      </div>
      </div>

      {/* DR.5: the bottom dock (spec §16.4's dock paragraph; §16.2
          `draft-dock`) — the ONE pattern hosting the five working panels on
          both platforms, replacing the M2 desktop rail (deleted in DR.4)
          and the M2 mobile four-way pane switcher (deleted here). The dock
          is a flex band BELOW the board zone; its open panel is absolutely
          positioned above the strip, over the board — the board zone's
          geometry never changes (D151). Every tab renders for every seat:
          the dock is not commissioner chrome, and no commissioner control
          lives in it (§8.7's one door is the bar's Draft Options). */}
      <DraftDock
        panels={{
          players: playersCard,
          queue: queueCard,
          roster: trackerCard,
          lists: listsCard,
          chat: chatCard,
        }}
      />

      {/* §8.7 panel — trigger-less and CONTROLLED since DR.2 (D153); the
          bar's Draft Options MENU is its one door since DR.3, opening it at
          the chosen section. Gated exactly as before:
          commissioner/co-commissioner on a NON-mock draft (D110(1) — the
          gate is `isCommish`, which carries `&& !draft.is_mock`). */}
      {isCommish && (
        // MP.6c: the inner check is a TYPE narrowing, not a second gate —
        // `isCommish` is already false without a league (a standalone
        // practice room's `myRole` is null and `canUseCommishPanel(null)` is
        // false), and §8.7's panel takes a `LeagueDetail` because it is a
        // league surface. A practice draft has no commissioner at all
        // (D110(1)/D226(2)).
        scope.league !== null &&
        scope.leagueId !== null && (
          <CommishDraftPanel
            leagueId={scope.leagueId}
            draft={draft}
            detail={scope.league}
            picks={picks}
            playerById={playerById}
            open={draftOptionsOpen}
            onOpenChange={(open) => {
              setDraftOptionsOpen(open)
              if (!open) setDraftOptionsSection(null)
            }}
            openAtSection={draftOptionsSection}
          />
        )
      )}

      {/* The lifted Add-a-draft-list modal (D119(6): mounted at room
          level, OUTSIDE every overlay — a sibling of the dock, never a
          panel body inside it). */}
      {scope.league !== null && scope.leagueId !== null && (
        <AddDraftListModal
          open={addListOpen}
          onOpenChange={setAddListOpen}
          leagueId={scope.leagueId}
          leagueName={scope.league.league.name}
          scoringSystemId={scope.league.league.scoring_system_id}
          attachedListIds={myAttachedListIds}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton / problem / honest-empty states (§16.5.4)
// ---------------------------------------------------------------------------

/**
 * The four resolver states, MP.6c: each takes its way out as `exitHref` +
 * `exitLabel` from the room's scope instead of building a league URL.
 *
 * **That is the R340 invariant restated for a room with no league** — the
 * `(room)` frame is chrome-free, so every state still carries an exit; what
 * changed is that a standalone practice room's exit goes to `/app/mocks` and
 * never says "Back to league", because it has none to go back to.
 * `room-exits.test.ts` moved with it: it now pins that every state has an
 * exit AND that not one of them hard-codes `/app/leagues`.
 */
function DraftRoomSkeleton({ exitHref, exitLabel }: RoomExit) {
  return (
    <div className="flex flex-col gap-4">
      {/* DR.2's deliberate call on DR.7(5)'s open question (R348; PROGRESS
          D176): the transient skeleton DOES get an exit. In the chrome-free
          frame a slow or hung fetch renders this state full-viewport with
          zero affordances — one link closes the last exit-less resolver
          state. Pinned in room-exits.test.ts. */}
      <div className="flex items-center justify-end">
        <Button variant="stroke" size="sm" asChild>
          <Link href={exitHref}>{exitLabel}</Link>
        </Button>
      </div>
      <Skeleton className="h-9 rounded-sm" />
      <Skeleton className="h-64 rounded-sm" />
    </div>
  )
}

function DraftRoomProblem({
  exitHref,
  exitLabel,
  title,
  body,
  onRetry,
}: RoomExit & {
  title: string
  body: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
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
              <Link href={exitHref}>{exitLabel}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DraftRoomEmpty({
  exitHref,
  exitLabel,
  title,
  body,
}: RoomExit & {
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold">{title}</p>
          <p className="text-[12px] font-medium text-n-3">{body}</p>
          <Button variant="stroke" size="sm" asChild>
            <Link href={exitHref}>{exitLabel}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The §9.3 takeover state (DR.6; D156 — RULED: newest tab wins). Renders in
 * the chrome-free frame when a NEWER tab of this browser profile claimed
 * the draft, so this tab released its channel and heartbeat. Honest about
 * the boundary: nothing about the draft itself is at risk — the server is
 * authoritative (§8.1) — this tab merely stopped spending a connection.
 * Carries its own exit (a chrome-free state with no way out is the R340
 * defect class; pinned in room-exits.test.ts) plus the ruled "Use this tab
 * instead" action, which re-claims the room; the then-newer tab releases
 * in turn.
 */
function DraftRoomTakenOver({
  exitHref,
  exitLabel,
  onReclaim,
}: RoomExit & {
  onReclaim: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold">This draft is open in another tab</p>
          <p className="text-[12px] font-medium text-n-3">
            You opened the room somewhere newer, so this tab let go of the live
            connection — one tab per browser keeps draft night fast. Your seat,
            picks and clock all run on the server and are untouched.
          </p>
          <div className="flex items-center gap-2.5">
            <Button variant="blue" size="sm" shadow onClick={onReclaim}>
              Use this tab instead
            </Button>
            <Button variant="stroke" size="sm" asChild>
              <Link href={exitHref}>{exitLabel}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
