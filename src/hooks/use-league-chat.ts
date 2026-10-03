'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

import type { DraftChatRow } from './use-draft-chat-ops'
import { useLeagueChannel } from './use-league-channel'

/**
 * League Home's message board (League UX batch 4, D479) — the league-wide
 * chat over `league_chat` rows with `context = 'league'`.
 *
 * Nothing new server-side: 065's policies already cover it. READ is the
 * member SELECT policy (RLS is the auth); WRITE is the same sanctioned
 * direct INSERT the draft room uses (D99) — membership + own `user_id` +
 * `is_system = FALSE` + 1..500 chars + `context = 'league'` are the policy's
 * WITH CHECK, so this hook cannot write anything the room's composer can't.
 *
 * Member messages only (`is_system = FALSE`): system posts (commissioner
 * actions, week notices) already render in the activity card beside it, and
 * showing them twice would be noise.
 *
 * LIVE: 070 broadcasts every non-draft `league_chat` row on `league:<id>`;
 * this JOINS the one refcounted room (F233(a) — never a second channel) and
 * re-reads on the event and on every (re)join (§9.3 — never trust a missed
 * broadcast).
 */

/** Latest-N window the board renders (ascending). A window, not the table. */
export const LEAGUE_CHAT_WINDOW = 30

export const leagueChatKeys = {
  board: (leagueId: string) => ['league-chat', leagueId] as const,
}

export function useLeagueChat(leagueId: string | undefined) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: leagueChatKeys.board(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<DraftChatRow[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_chat')
        .select('id, user_id, message, context, is_system, created_at')
        .eq('league_id', leagueId!)
        .eq('context', 'league')
        .eq('is_system', false)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(LEAGUE_CHAT_WINDOW)
      if (error) throw error
      return ((data ?? []) as DraftChatRow[]).reverse()
    },
  })

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueChatKeys.board(leagueId) })
  }
  const { connection } = useLeagueChannel(leagueId, { league_chat: invalidate }, { onJoin: invalidate, onDrop: invalidate })

  return { ...query, connection }
}

export function useSendLeagueChat(leagueId: string, userId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (message: string): Promise<DraftChatRow> => {
      if (!userId) throw new Error('Sign in to post.')
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_chat')
        .insert({
          league_id: leagueId,
          user_id: userId, // must equal auth.uid() — the 065 policy
          message: message.trim(),
          context: 'league',
          is_system: false,
        })
        .select('id, user_id, message, context, is_system, created_at')
        .single()
      if (error) throw new Error(error.message)
      return data as DraftChatRow
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leagueChatKeys.board(leagueId) })
    },
  })
}
