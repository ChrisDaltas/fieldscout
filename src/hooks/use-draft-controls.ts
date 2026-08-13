'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'

import { draftKeys } from './use-draft'
import {
  forcePickRequest,
  memberAutodraftRequest,
  movePlayerRequest,
  pauseResumeRequest,
  reassignRequest,
  resetRequest,
  setClockRequest,
  undoRequest,
  type ControlRequest,
} from './use-draft-controls-ops'
import { leaguesKeys } from './use-leagues'

/**
 * Commissioner control mutations (M2 task L.B3.3; spec §8.7 via the L.B2.3
 * routes — D114's one dispatch pipeline; D92: every mutation is a route).
 *
 * Request shapes come from the PURE builders in use-draft-controls-ops.ts
 * (the pinnable panel→route wiring); this file only fires them and settles
 * the caches. Every control's system chat post arrives through the room's
 * `league_chat` broadcast (the §16.3 transparency loop — no extra wiring),
 * and the drafts/picks broadcasts carry the state change; the settle-time
 * invalidation is the §9.3 belt-and-braces reconcile, not the render path.
 *
 * NOT here: mock affordances (D110(1) — the panel never renders on a mock),
 * and the seat-reassign control (composed from M1's membership surface —
 * use-league-members.ts' hooks — per the task's no-new-RPC clause).
 */

function useControlMutation<TVars>(
  leagueId: string,
  draftId: string,
  toRequest: (vars: TVars) => ControlRequest,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const request = toRequest(vars)
      return sendLeagueAction<unknown>(request.path, jsonInit('POST', request.body))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(draftId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    },
  })
}

/** POST …/draft/pause — pause | resume (one route, `action` body verb). */
export function usePauseResumeDraft(leagueId: string, draftId: string) {
  return useControlMutation(
    leagueId,
    draftId,
    (vars: { action: 'pause' | 'resume'; reason?: string }) =>
      pauseResumeRequest(leagueId, draftId, vars.action, vars.reason),
  )
}

/** POST …/draft/clock — E15 (subsequent picks; optional current extension). */
export function useSetDraftClock(leagueId: string, draftId: string) {
  return useControlMutation(
    leagueId,
    draftId,
    (vars: { pickTimerSeconds: number; extendCurrent: boolean; reason?: string }) =>
      setClockRequest(leagueId, draftId, vars.pickTimerSeconds, vars.extendCurrent, vars.reason),
  )
}

/** POST …/draft/undo — single (`toPickNumber` null) or cascade (E4; 0 = the
 *  R160 full rewind). */
export function useUndoDraft(leagueId: string, draftId: string) {
  return useControlMutation(
    leagueId,
    draftId,
    (vars: { toPickNumber: number | null; reason?: string }) =>
      undoRequest(leagueId, draftId, vars.toPickNumber, vars.reason),
  )
}

/** POST …/draft/reassign — corrected team and/or player for one pick. */
export function useReassignPick(leagueId: string, draftId: string) {
  return useControlMutation(
    leagueId,
    draftId,
    (vars: { pickId: string; teamId?: string; playerId?: string; reason?: string }) =>
      reassignRequest(
        leagueId,
        draftId,
        vars.pickId,
        { teamId: vars.teamId, playerId: vars.playerId },
        vars.reason,
      ),
  )
}

/**
 * POST …/draft/force-pick. The wrapper mints ONE `action_id` per submit
 * (D68(1)/D114(4) — the same stamping contract as `useMakePick`): a React
 * Query retry replays server-side as E2 instead of double-picking.
 */
export function useForcePick(leagueId: string, draftId: string) {
  const mutation = useControlMutation(
    leagueId,
    draftId,
    (vars: { playerId: string; actionId: string; reason?: string }) =>
      forcePickRequest(leagueId, draftId, vars.playerId, vars.actionId, vars.reason),
  )
  return {
    ...mutation,
    forcePick: (playerId: string, reason?: string) =>
      mutation.mutate({ playerId, actionId: crypto.randomUUID(), reason }),
    forcePickAsync: (playerId: string, reason?: string) =>
      mutation.mutateAsync({ playerId, actionId: crypto.randomUUID(), reason }),
  }
}

/** POST …/draft/move-player — move a drafted player between teams. */
export function useMovePlayer(leagueId: string, draftId: string) {
  return useControlMutation(
    leagueId,
    draftId,
    (vars: { playerId: string; fromTeam: string; toTeam: string; reason?: string }) =>
      movePlayerRequest(leagueId, draftId, vars.playerId, vars.fromTeam, vars.toTeam, vars.reason),
  )
}

/** POST …/draft/reset — the hard-confirm wipe back to `scheduled`. */
export function useResetDraft(leagueId: string, draftId: string) {
  return useControlMutation(leagueId, draftId, (vars: { reason?: string }) =>
    resetRequest(leagueId, draftId, vars.reason),
  )
}

/**
 * PATCH …/members/[mid] `{ is_autodraft }` — the §8.7 any-team autopick
 * toggle (072's `set_team_autodraft`, commissioner path: the RPC posts the
 * system chat message when a live draft exists). `is_autodraft` lives on
 * `league_members`, so the league detail is the cache to settle.
 */
export function useSetMemberAutodraft(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { memberId: string; on: boolean }) => {
      const request = memberAutodraftRequest(leagueId, vars.memberId, vars.on)
      return sendLeagueAction<unknown>(request.path, jsonInit('PATCH', request.body))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    },
  })
}
