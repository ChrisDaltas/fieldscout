'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { Draft } from '@/types/database'

/**
 * Mock-draft surface hooks — M2 task L.B3.5 (spec §8.8/§15.2; D110/D114(5)).
 * Thin React Query wrappers over the L.B2.3 mock routes; every rule lives
 * server-side (caps, seat validation, launcher-only delete — the RPCs'), so
 * these only plumb requests and keep the list cache honest.
 */

export const mockDraftKeys = {
  list: (leagueId: string) => ['mock-drafts', leagueId] as const,
}

/** The GET's column-selected row (draft-service `listMockDrafts`). */
export interface MockDraftSummary {
  id: string
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

/** DELETE /api/leagues/[id]/mock-drafts/[did] — abandon a paused mock OR
 *  delete a finished recap (one verb covers both — §8.8; launcher-only,
 *  the RPC refuses everyone else including commissioners, D110(1)). */
export function useDeleteMockDraft(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draftId: string) =>
      sendLeagueAction<{ deleted: boolean; draft_id: string }>(
        `/api/leagues/${leagueId}/mock-drafts/${draftId}`,
        jsonInit('DELETE'),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mockDraftKeys.list(leagueId) })
    },
  })
}
