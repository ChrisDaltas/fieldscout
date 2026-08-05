'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Draft } from '@/types/database'

import { useLeague } from './use-league'
import { leaguesKeys } from './use-leagues'

/**
 * Draft data spine — M2 task L.B2.1 (spec §15.6; tasks-M2 D92).
 *
 * READS are RLS-scoped direct SELECTs (D92: §15.2 prints no draft GET on
 * purpose — `drafts`/`draft_picks` are member-SELECTable, the
 * use-league-invites/use-scoring-templates hook precedent). This file is the
 * FETCH HALF only: the `draft:<id>` subscribe/refetch loop (§9.3
 * fetch-then-subscribe, state_version gap ⇒ refetch) lands with the room
 * shell in L.B3.1 and layers onto these queries without changing them.
 *
 * WRITES are React Query mutations over the §15.2 routes (D92: every
 * mutation is a Route Handler → RPC; never client DML).
 */

export const draftKeys = {
  detail: (draftId: string) => ['draft', draftId] as const,
}

/** The board-relevant slice of a pick row (undone picks included — §12.4
 *  keeps them for audit; board consumers filter `is_undone`). */
export interface DraftPickSummary {
  id: string
  pick_number: number
  round: number | null
  team_id: string
  player_id: string
  is_auto: boolean | null
  is_undone: boolean | null
  made_via: string | null
  created_at: string | null
}

export interface DraftState {
  draft: Draft | null
  picks: DraftPickSummary[]
}

/** Authoritative draft state: the drafts row + its picks (RLS member SELECT). */
export function useDraft(draftId: string | undefined) {
  return useQuery({
    queryKey: draftKeys.detail(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftState> => {
      const supabase = createBrowserClient()
      const [draftRes, picksRes] = await Promise.all([
        supabase.from('drafts').select('*').eq('id', draftId!).maybeSingle(),
        supabase
          .from('draft_picks')
          .select(
            'id, pick_number, round, team_id, player_id, is_auto, is_undone, made_via, created_at',
          )
          .eq('draft_id', draftId!)
          .order('pick_number', { ascending: true }),
      ])
      if (draftRes.error) throw draftRes.error
      if (picksRes.error) throw picksRes.error
      return {
        draft: (draftRes.data as Draft | null) ?? null,
        picks: (picksRes.data ?? []) as DraftPickSummary[],
      }
    },
  })
}

/**
 * The GET-detail active-draft summary (L.B2.1): non-mock, one row at most
 * (the D95 partial unique). `scheduled_at` is `settings.draft
 * .draft_scheduled_at` — D95's single pre-start store — so it can be
 * populated while `id` is not yet minted (a league scheduled purely through
 * the settings surface has no drafts row until start/tick — D94).
 */
export interface ActiveDraftSummary {
  id: string
  status: 'scheduled' | 'live' | 'paused'
  draft_type: string
  started_at: string | null
  scheduled_at: string | null
}

/**
 * Lobby / home-CTA / draft-bar summary — rides `getLeagueDetail`'s
 * `active_draft` field (one fetch feeds the whole league surface; the
 * detail invalidation the mutations below issue refreshes it).
 */
export function useActiveDraft(leagueId: string | undefined) {
  const detail = useLeague(leagueId)
  return {
    /** The active non-mock draft, or null when none exists yet. */
    activeDraft: detail.data?.active_draft ?? null,
    /** The league's own status ('scheduled'/'drafting' drive the CTAs). */
    leagueStatus: detail.data?.league.status ?? null,
    /** D95: the scheduled instant survives even with no drafts row. */
    scheduledAt:
      detail.data?.active_draft?.scheduled_at ??
      detail.data?.settings.draft.draft_scheduled_at ??
      null,
    isLoading: detail.isLoading,
    isError: detail.isError,
    error: detail.error,
  }
}

// ---------------------------------------------------------------------------
// Mutations (all over the L.B2.1 routes — D92)
// ---------------------------------------------------------------------------

function useInvalidateLeagueDetail(leagueId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
  }
}

/** POST /api/leagues/[id]/draft — create/schedule (commish; idempotent). */
export function useCreateDraft(leagueId: string) {
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async () =>
      sendLeagueAction<{ draft: Draft; created: boolean }>(
        `/api/leagues/${leagueId}/draft`,
        jsonInit('POST'),
      ),
    onSuccess: invalidate,
  })
}

/** PATCH body for the pre-start order edit (exactly one of the two). */
export type DraftOrderBody = { order: string[] } | { randomize: true }

/** PATCH /api/leagues/[id]/draft — pre-start order edit incl. randomize. */
export function useDraftOrder(leagueId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async (body: DraftOrderBody) =>
      sendLeagueAction<{ draft: Draft }>(`/api/leagues/${leagueId}/draft`, jsonInit('PATCH', body)),
    onSuccess: (data) => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(data.draft.id) })
    },
  })
}

/** POST /api/leagues/[id]/draft/start — the commissioner's manual start. */
export function useStartDraft(leagueId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async () =>
      sendLeagueAction<{ draft: Draft; started: boolean }>(
        `/api/leagues/${leagueId}/draft/start`,
        jsonInit('POST'),
      ),
    onSuccess: (data) => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(data.draft.id) })
    },
  })
}
