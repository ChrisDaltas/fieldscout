'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Do-Not-Draft marks — M3 task L.C3.3 (spec §12.24 `draft_dnd_marks`
 * (v2.10), §16.4's player-table callout, §9.2's blind-data rule; tasks-M3
 * D139, C42; PROGRESS D194).
 *
 * ## DISPLAY-ONLY. THE ENGINE NEVER READS THIS TABLE.
 *
 * C42/OQ 20 (RULED 2026-08-16, Chris): the autopick-skip behaviour was
 * offered and **explicitly DECLINED** — recorded in the ruling, in §12.24
 * and here so it is never re-proposed as an oversight. A mark is a label
 * in the auction player table and nothing else: autopick, the Targets
 * fallback and system nominations ignore it entirely, and **no RPC,
 * trigger, worker or service path may ever join against
 * `draft_dnd_marks`**. `auction-player-table.test.ts` sweeps the
 * migrations and the engine's TypeScript for exactly that, as a
 * dispositioned enumeration — a new reader fails the suite.
 *
 * ## Why the writes are direct (and why that is not a doctrine breach)
 *
 * The house rule is server-authoritative: clients never write draft state.
 * Marks are not draft state — they are private PREP, like `draft_queues`,
 * and §12.24 ships the same own-rows `FOR ALL` policy (`USING` +
 * `WITH CHECK` on `user_id = auth.uid()`) precisely so the client can own
 * them. The banner names this: *"own `draft_dnd_marks` row via direct RLS
 * write, the `draft_queues`-class sanctioned client write"*. Nothing here
 * can affect a pick, a bid, a budget or a clock; the worst a forged write
 * can do is mislabel a row in the forger's own table.
 *
 * Scope is per (draft, user) — a mock's marks never pollute the real
 * draft's, and a `draft_reset` keeps them (prep, not draft state; 087's
 * clear list excludes them deliberately — D139).
 *
 * NEVER BROADCAST (§9.2): no channel is opened here and no trigger exists
 * on the table. Freshness is this client's own mutations — the same
 * posture `useDraftQueue` documents for queues.
 *
 * OPTIMISTIC on intent, which §15.6 permits for exactly this class: the
 * optimism is over a private label, never over a draft RESULT (a bid or a
 * nomination is never optimistic — see `use-draft-auction.ts`). The set
 * flips instantly, rolls back on error and refetches on settle.
 */

export const draftDndKeys = {
  marks: (draftId: string) => ['draft-dnd-marks', draftId] as const,
}

/** My marks for this draft, as an id set (own rows only — the §12.24
 *  policy is what scopes it; `idx_draft_dnd_user` serves the read). */
export function useDraftDndMarks(draftId: string | undefined) {
  return useQuery({
    queryKey: draftDndKeys.marks(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('draft_dnd_marks')
        .select('player_id')
        .eq('draft_id', draftId!)
      if (error) throw error
      return (data ?? []).map((row) => row.player_id)
    },
  })
}

interface ToggleDndVars {
  playerId: string
  /** Current state — the mutation flips it (the `useToggleFavorite`
   *  shape, so the caller never has to guess what the server holds). */
  marked: boolean
}

/**
 * Toggle one mark. INSERT to mark, DELETE to clear — both scoped to
 * (draft, me, player) by the row's own UNIQUE and by RLS.
 *
 * `userId` is passed in rather than read here because the room already
 * holds it; the WITH CHECK on the policy is what actually enforces it, so
 * a wrong value is refused by the database rather than trusted.
 */
export function useToggleDndMark(draftId: string, userId: string | undefined) {
  const queryClient = useQueryClient()
  const queryKey = draftDndKeys.marks(draftId)
  return useMutation({
    mutationFn: async ({ playerId, marked }: ToggleDndVars) => {
      const supabase = createBrowserClient()
      if (marked) {
        const { error } = await supabase
          .from('draft_dnd_marks')
          .delete()
          .eq('draft_id', draftId)
          .eq('player_id', playerId)
        if (error) throw error
        return { marked: false }
      }
      const { error } = await supabase
        .from('draft_dnd_marks')
        .insert({ draft_id: draftId, user_id: userId!, player_id: playerId })
      if (error) throw error
      return { marked: true }
    },
    onMutate: async ({ playerId, marked }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<string[]>(queryKey)
      const next = new Set(previous ?? [])
      if (marked) next.delete(playerId)
      else next.add(playerId)
      queryClient.setQueryData<string[]>(queryKey, Array.from(next))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
