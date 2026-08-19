'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
  autoStartPollMs,
  describeDraftTime,
  draftCountdown,
} from '@/components/leagues/league-home-states-ops'
import { PracticeCta } from '@/components/leagues/league-home-states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { draftKeys, useStartDraft } from '@/hooks/use-draft'
import { leaguesKeys } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { Draft } from '@/types/database'
import type { LeagueDetail } from '@/hooks/use-league'

import { DraftCommandBar } from './draft-command-bar'
import {
  deriveLobbyChecklist,
  draftTimeReachedLine,
  lobbyAutopickTeamIds,
  lobbyFranchiseCapacity,
  lobbyOrderTeamIds,
} from './draft-lobby-ops'
import { PresenceBar, type PresenceSeat } from './presence-bar'

interface DraftLobbyProps {
  leagueId: string
  detail: LeagueDetail
  /** The scheduled drafts row when one exists; null = the D94 settings-only
   *  path (no row yet — the tick creates it at the instant). */
  draft: Draft | null
  /** Presence (room channel) — only meaningful when a drafts row exists;
   *  the no-row lobby has no channel and hides the seat strip. */
  onlineTeamIds?: ReadonlySet<string>
  myTeamId: string | null
  isCommish: boolean
}

/**
 * Draft lobby — the pre-start room state (M2 task L.B3.4; spec §8.5.1,
 * §16.5.2 draft-night row: "lobby (presence, checklist) → order reveal (if
 * configured) → live room"). Renders where the room route used to show its
 * honest "hasn't started" empty:
 *
 * - **Presence** — who's already in the room, keyed by team (the room
 *   shell's ONE channel; the lobby is just an earlier state of the same
 *   page, so joining here is what §16.5.1's drafting row later counts).
 * - **Checklist** — seats / settings / order readiness (pure ops).
 * - **Order display** — the post-randomize list, plain and instant (D101;
 *   the reveal ANIMATION is deliberately absent — Phase F, F43).
 * - **Start button** (commissioner) — `draft_start` owns every refusal;
 *   friendly strings surface verbatim.
 * - **Auto-start countdown** (D94) — the server starts the draft at
 *   `draft_scheduled_at` whether or not anyone is here; countdown math is
 *   pure + nowMs-injected, and near/past the instant the lobby polls so the
 *   D94 flip arrives even with no channel (the no-row path has none).
 *
 * DR.7(4): the lobby mounts the room's own `DraftCommandBar` (the lobby
 * shares the chrome-free live surface — Q12), with the model's `lobby` arm:
 * status "Draft scheduled" + the unconditional Exit Draft, no controls.
 * Both lobby arms (this scheduled-draft one and the D94 no-row one) render
 * through this component, so one mount covers both — and when the start
 * flip arrives (D120) the live room re-renders the SAME bar component in
 * one React commit, so the chrome carries across the lobby→live flip.
 */
export function DraftLobby({
  leagueId,
  detail,
  draft,
  onlineTeamIds,
  myTeamId,
  isCommish,
}: DraftLobbyProps) {
  const scheduledAt = detail.settings.draft.draft_scheduled_at
  const timeZone = detail.settings.draft.time_zone

  const orderIds = lobbyOrderTeamIds(draft?.draft_order, detail.settings.draft.draft_order)
  const checklist = deriveLobbyChecklist(detail, orderIds)
  // R274: the D96 capacity read — the reached-instant banner only promises an
  // auto-start `draft_start` can actually deliver (066 refuses on a franchise
  // mismatch; the tick retries + records that refusal every ~5s, 068).
  const capacity = lobbyFranchiseCapacity(detail)
  const teamsById = new Map(detail.teams.map((t) => [t.id, t.name]))
  const autopickIds = lobbyAutopickTeamIds(detail.members)

  const seats: PresenceSeat[] | null = onlineTeamIds
    ? (orderIds.length > 0 ? orderIds : detail.teams.map((t) => t.id)).map((teamId) => ({
        teamId,
        name: teamsById.get(teamId) ?? 'Team',
        online: onlineTeamIds.has(teamId),
        onClock: false, // nobody is on the clock before the first pick
        isMe: teamId === myTeamId,
        autopick: autopickIds.has(teamId),
      }))
    : null

  // ----- start (commissioner) — the server owns every refusal -------------
  const startDraft = useStartDraft(leagueId)
  const handleStart = () => {
    startDraft.mutateAsync().catch((error: unknown) => {
      toast({
        title: "Couldn't start the draft",
        description:
          error instanceof LeagueActionError
            ? error.message // draft_start's friendly refusal, verbatim
            : 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    })
  }

  // ----- D94 auto-start watch ---------------------------------------------
  // Component-layer wall clock (D82(4)): the pure ops take nowMs.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const queryClient = useQueryClient()
  const pollMs = autoStartPollMs(scheduledAt, nowMs)
  const draftId = draft?.id ?? null
  useEffect(() => {
    if (pollMs === null) return
    // Near/past the instant the TICK starts the draft server-side (creating
    // the row if absent). The row path usually learns via broadcast; the
    // poll is the honest fallback that also covers the no-row/no-channel
    // path. Bounded: only while the lobby is mounted inside the window.
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
      if (draftId) {
        void queryClient.invalidateQueries({ queryKey: draftKeys.detail(draftId) })
      }
    }, pollMs)
    return () => clearInterval(timer)
  }, [pollMs, leagueId, draftId, queryClient])

  const cd = scheduledAt ? draftCountdown(scheduledAt, nowMs) : null
  const display = scheduledAt ? describeDraftTime(scheduledAt, timeZone) : null

  return (
    <div className="flex flex-col gap-4">
      {/* DR.7(4): the pre-start state gets the room's own bar — the lobby
          shares the live surface (Q12) and the bar is its one status voice
          (§16.3 say-a-thing-once) and its one exit (the bar's Exit Draft is
          unconditional — Q13; pinned in draft-command-bar.test.ts). The
          model's `lobby` arm renders status ("Draft scheduled") + Exit and
          gates every control: nothing runs pre-start, so there is no
          Pause/Resume, and §8.7's Draft Options act on a draft in flight —
          the lobby's own commissioner affordances (Start draft now, Draft
          setup) stay in the card below. This replaced BOTH the no-op
          `PageHeader` (it wrote to a store only the shell's AppHeader
          reads — R340's mechanism) and the card's in-card Back-to-league +
          "Draft scheduled" badge, each a second voice under the bar. */}
      <DraftCommandBar
        leagueId={leagueId}
        bar={{
          commishRole: isCommish,
          isMock: false,
          isMockLauncher: false,
          paused: false,
          lobby: true,
        }}
        hasSeat={Boolean(myTeamId)}
        hasSchedule={Boolean(scheduledAt)}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <Icon name="clock" size={15} className="mr-1.5 inline align-[-2px]" />
            Draft night
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {cd && display ? (
            <div className="flex flex-col gap-2">
              {cd.isPast ? (
                <p className="text-[13px] font-bold">{draftTimeReachedLine(capacity)}</p>
              ) : (
                <p className="text-[13px] font-bold">
                  Starts in{' '}
                  <span className="fs-num">
                    {cd.days > 0 ? `${cd.days}d ` : ''}
                    {String(cd.hours).padStart(2, '0')}:{String(cd.minutes).padStart(2, '0')}:
                    {String(cd.seconds).padStart(2, '0')}
                  </span>
                </p>
              )}
              <p className="text-[11px] font-semibold text-n-3">
                League time · <span className="fs-num text-ink">{display.leagueTime}</span>
                {display.leagueOffset && <span> ({display.leagueOffset})</span>} — starts
                automatically at the scheduled time{isCommish ? ', or start it now' : ''}.
              </p>
            </div>
          ) : (
            <p className="text-[12px] font-semibold text-n-3">
              No draft time is set{isCommish ? ' — schedule one in League settings, or start now' : ' yet'}.
            </p>
          )}

          {/* R340's exit obligation now rides the command bar above: its
              Exit Draft is unconditional and un-gated (Q13), so a plain
              member always has a way out at every width — the in-card
              Back-to-league this block used to carry was a second exit
              voice under the bar and retired with DR.7(4). Pinned in
              `room-exits.test.ts` (the lobby pins now assert the un-gated
              bar mount). The commissioner's own affordances stay HERE —
              they are the lobby's content, not room chrome. */}
          {isCommish && (
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
                disabled={startDraft.isPending}
                onClick={handleStart}
              >
                <Icon name="fire" size={13} />
                {startDraft.isPending ? 'Starting…' : 'Start draft now'}
              </Button>
              <Button variant="stroke" size="sm" asChild>
                <Link href={`/app/leagues/${leagueId}/settings`}>
                  <Icon name="setup" size={13} />
                  Draft setup
                </Link>
              </Button>
            </div>
          )}

          {/* §16.5.2 mock-workflow row: the LOBBY is the map's SECOND practice
              entry point ("Practice card · draft lobby") — mounted for every
              member, not just the commissioner (§8.8's launch rule). Composed
              from the home's own CTA, not forked (R279). */}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-n-4 pt-3">
            <PracticeCta leagueId={leagueId} />
            <p className="text-[10px] font-semibold text-n-3">
              Rehearse against CPU opponents — your real draft isn&apos;t touched.
            </p>
          </div>
        </CardContent>
      </Card>

      {seats && (
        <Card>
          <CardHeader>
            <CardTitle>In the lobby</CardTitle>
          </CardHeader>
          <CardContent>
            <PresenceBar seats={seats} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ready for draft night?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {checklist.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2.5 rounded-sm border border-n-4 px-2.5 py-2"
              >
                <Icon
                  name={item.done ? 'check-circle' : 'setup'}
                  size={16}
                  className={item.done ? 'shrink-0 text-positive-strong' : 'shrink-0 text-n-3'}
                />
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-extrabold leading-tight">
                    {item.label}
                  </div>
                  <div className="truncate text-[10px] font-semibold text-n-3">{item.detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Draft order</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {orderIds.length > 0 ? (
              // D101: the post-randomize list, plain and instant — the
              // reveal animation is deliberately Phase F (F43).
              <ol className="flex flex-col gap-1">
                {orderIds.map((teamId, i) => (
                  <li
                    key={teamId}
                    className="flex items-center gap-2 rounded-sm border border-n-4 px-2.5 py-1.5 text-[12px] font-bold"
                  >
                    <span className="fs-num w-6 shrink-0 text-right text-n-3">{i + 1}.</span>
                    <span className="truncate">
                      {teamsById.get(teamId) ?? 'Team'}
                      {teamId === myTeamId ? ' (You)' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] font-semibold text-n-3">
                {detail.settings.draft.draft_order_mode === 'random'
                  ? 'The order randomizes when the draft starts — or the commissioner can randomize it early in Draft setup.'
                  : 'No saved order yet. The commissioner sets it in Draft setup.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
