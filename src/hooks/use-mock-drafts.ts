'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { StandaloneMockSettings } from '@/lib/leagues/api/draft-service'
import type { Draft } from '@/types/database'

/**
 * Mock-draft surface hooks — M2 task L.B3.5 (spec §8.8/§15.2; D110/D114(5)).
 * Thin React Query wrappers over the L.B2.3 mock routes; every rule lives
 * server-side (caps, seat validation, launcher-only delete — the RPCs'), so
 * these only plumb requests and keep the list cache honest.
 */

export const mockDraftKeys = {
  list: (leagueId: string) => ['mock-drafts', leagueId] as const,
  /** Every mock I launched, league or not — the `/app/mocks` home (MP.5).
   *  Under the same `['mock-drafts', …]` prefix the launch mutations
   *  already invalidate, which is why `useLaunchStandaloneMock` needed no
   *  edit to keep this list honest. */
  mine: ['mock-drafts', 'mine'] as const,
}

/** The GET's column-selected row (draft-service `listMockDrafts`). */
export interface MockDraftSummary {
  id: string
  /** NULL ⇒ a STANDALONE practice draft (v2.16 §8.8) — the discriminant
   *  `MockRow` branches its links and its delete door on. */
  league_id: string | null
  status: 'live' | 'paused' | 'complete'
  draft_type: string
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  current_pick_number: number | null
  current_round: number | null
  total_rounds: number | null
  config: unknown
}

export interface MockDraftLists {
  /** live|paused — the §16.5.2 resumable cards (E59). */
  active: MockDraftSummary[]
  /** complete — recaps, kept until owner-deleted (§8.8). */
  recaps: MockDraftSummary[]
}

/** GET /api/leagues/[id]/mock-drafts — MY mocks in this league (launcher-
 *  scoped server-side; a non-launcher member simply reads empty lists). */
export function useMockDrafts(leagueId: string | undefined, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mockDraftKeys.list(leagueId ?? 'none'),
    enabled: Boolean(leagueId) && (opts?.enabled ?? true),
    queryFn: async (): Promise<MockDraftLists> =>
      sendLeagueAction<MockDraftLists>(`/api/leagues/${leagueId}/mock-drafts`),
  })
}

/**
 * GET /api/mocks — EVERY mock I launched, league-attached or standalone.
 * The `/app/mocks` practice home's read (MP.5).
 *
 * Same shape as `useMockDrafts` above on purpose (`MockDraftLists`), because
 * the rows render through the same `MockRow`. What differs is the QUESTION:
 * this one has no league in it. Not `useMockDrafts(undefined)` — that hook
 * disables itself without a league id, which is the correct answer to a
 * league-scoped question and the wrong one here.
 */
export function useMyMockDrafts(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mockDraftKeys.mine,
    enabled: opts?.enabled ?? true,
    queryFn: async (): Promise<MockDraftLists> => sendLeagueAction<MockDraftLists>('/api/mocks'),
  })
}

export interface LaunchMockVariables {
  human_team_id?: string
  cpu_speed?: 'realistic' | 'fast'
  /** Stamped by the wrapper below — one UUID per user submit (D68(1)). */
  action_id: string
}

/**
 * POST /api/leagues/[id]/mock-drafts — launch (§8.8 "Practice this draft").
 * Idempotency per D110(11)/R149: `launchMock` stamps ONE `action_id` per
 * user submit, so a React Query retry (or a double-tap resubmitting the same
 * variables) replays server-side as the SAME mock (`created: false` = the
 * same 2xx) instead of minting a second one. Callers use the wrappers, not
 * `mutate` directly.
 */
export function useLaunchMockDraft(leagueId: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (variables: LaunchMockVariables) =>
      sendLeagueAction<{ draft: Draft; created: boolean }>(
        `/api/leagues/${leagueId}/mock-drafts`,
        jsonInit('POST', variables),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mockDraftKeys.list(leagueId) })
    },
  })

  return {
    ...mutation,
    launchMockAsync: (input: Omit<LaunchMockVariables, 'action_id'>) =>
      mutation.mutateAsync({ ...input, action_id: crypto.randomUUID() }),
  }
}

export interface LaunchStandaloneMockVariables {
  cpu_speed?: 'realistic' | 'fast'
  settings: StandaloneMockSettings
  /** Stamped by the wrapper below — one UUID per user submit (D68(1)). */
  action_id: string
}

/**
 * POST /api/mocks — launch a STANDALONE practice draft (MP task MP.4; spec
 * v2.16 §8.8). Same dedupe contract as the league launcher above: ONE
 * `action_id` per user submit, so a React Query retry or a double-tap
 * replays server-side as the SAME mock instead of minting a second one —
 * and a second one here would also mint a second set of bot seats.
 *
 * The cache invalidation is the `['mock-drafts', …]` PREFIX rather than a
 * key of its own: the standalone list is MP.5's surface and owns its key,
 * and a key invented here that nothing reads would be a claim nobody checks
 * (D236(4)). The prefix covers whatever MP.5 registers, and today covers the
 * league-scoped lists that a standalone launch cannot change (a no-op
 * refetch is the cheap side of that trade).
 */
export function useLaunchStandaloneMock() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (variables: LaunchStandaloneMockVariables) =>
      sendLeagueAction<{ draft: Draft; created: boolean }>(
        '/api/mocks',
        jsonInit('POST', variables),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mock-drafts'] })
    },
  })

  return {
    ...mutation,
    launchStandaloneAsync: (input: Omit<LaunchStandaloneMockVariables, 'action_id'>) =>
      mutation.mutateAsync({ ...input, action_id: crypto.randomUUID() }),
  }
}

/**
 * Delete a mock — abandon a live/paused one OR delete a finished recap (one
 * verb covers both, §8.8; launcher-only, and the RPC refuses everyone else
 * including commissioners — D110(1)).
 *
 * TWO DOORS, one per shape, because the shipped league route is
 * `/api/leagues/[id]/mock-drafts/[did]` and a standalone mock has no id to
 * put in that slot: `leagueId === null` uses `/api/mocks/[mockId]`. Same
 * RPC behind both (095's `delete_mock_draft`), same refusals.
 *
 * Invalidates the whole `['mock-drafts', …]` PREFIX rather than one key:
 * a mock deleted from the practice home also leaves its league's list, and
 * one deleted from a league launcher also leaves the practice home. A
 * key-by-key invalidation here is how the two lists start disagreeing.
 */
export function useDeleteMockDraft(leagueId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draftId: string) =>
      sendLeagueAction<{ deleted: boolean; draft_id: string }>(
        leagueId === null
          ? `/api/mocks/${draftId}`
          : `/api/leagues/${leagueId}/mock-drafts/${draftId}`,
        jsonInit('DELETE'),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mock-drafts'] })
    },
  })
}
