'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

import {
  DRAFT_CHAT_WINDOW,
  reduceChatEvent,
  type DraftChatRow,
} from './use-draft-chat-ops'

/**
 * Draft chat data (M2 task L.B3.3; spec §8.8/§16.2 draft-chat; D99).
 *
 * READ: an RLS-scoped direct SELECT (D92's read rule; the 065 membership
 * SELECT policy is the auth) over `league_chat` for this draft's context —
 * the latest `DRAFT_CHAT_WINDOW` rows, rendered ascending. LIVE updates ride
 * the room's ONE existing channel (§9.3's ≤3 budget — no second
 * subscription): `useDraftRoom` applies `league_chat` broadcasts into this
 * query's cache through the pure reducer, and invalidates it on every
 * confirmed (re)join (chat has no gap detector — id-dedupe + join-refetch is
 * the missed-message recovery).
 *
 * WRITE: the ONE spec-sanctioned direct client INSERT (§9.3/D99 — no chat
 * route exists on purpose). The 065 policy is the contract: membership +
 * own `user_id` + `is_system = FALSE` + 1..500 chars + this draft's exact
 * context grammar. System posts are RPC-only — this hook can never write
 * one, and the WITH CHECK pins it.
 */

export const draftChatKeys = {
  room: (draftId: string) => ['draft-chat', draftId] as const,
}

/** The exact §12.13 context grammar for a draft room ('draft:<draft_id>'). */
export function draftChatContext(draftId: string): string {
  return `draft:${draftId}`
}

/**
 * MP.6c / ledger **F114** — THE READ IS KEYED ON THE DRAFT, NOT ON A LEAGUE.
 *
 * It used to be `enabled: Boolean(leagueId && draftId)` with an
 * `.eq('league_id', leagueId)` filter, so on a STANDALONE practice draft
 * (`league_id IS NULL` — 095) the query never ran and the engine's own D97
 * system posts (pause, resume, the clock notices) were invisible in the one
 * room that has nothing else to announce them. The rows existed and were
 * readable the whole time (095 + pgTAP 043 §C: two written, two read) —
 * this was a query that did not ask for them.
 *
 * `context = 'draft:<draft_id>'` is the column EVERY writer stamps (§12.13's
 * grammar) and the column the RLS arm itself keys on, so it selects exactly
 * this room's posts for a league draft and a league-less one alike — and RLS,
 * not this filter, is what keeps another room's chat unreadable.
 */
export function useDraftChat(draftId: string | undefined) {
  return useQuery({
    queryKey: draftChatKeys.room(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftChatRow[]> => {
      const supabase = createBrowserClient()
      // Latest-N window (desc + reverse): the pane renders the recent scroll
      // ascending; the window never claims to be the whole history.
      const { data, error } = await supabase
        .from('league_chat')
        .select('id, user_id, message, context, is_system, created_at')
        .eq('context', draftChatContext(draftId!))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(DRAFT_CHAT_WINDOW)
      if (error) throw error
      return ((data ?? []) as DraftChatRow[]).reverse()
    },
  })
}

/**
 * Send one ordinary chat message (the sanctioned direct INSERT — D99).
 * `is_system` is sent FALSE explicitly (the policy's WITH CHECK pins it; the
 * explicit value keeps the sanctioned write self-describing). On success the
 * returned row is folded into the cache through the reducer — the broadcast
 * echo of the same INSERT dedupes by id when it arrives.
 *
 * **`leagueId` is `string | null`, and NULL is a refusal, not a blank**
 * (R534). Sending is league-only (D226(2)): a standalone practice room
 * renders the feed and no composer, so this mutation is unfireable there —
 * but the caller still has to instantiate the hook, and handing it `''`
 * would be the placeholder-id idiom the codebase refuses everywhere else.
 * A null league says what is true, and firing it anyway fails loudly rather
 * than posting a row keyed on nothing.
 */
export function useSendDraftChat(
  leagueId: string | null,
  draftId: string,
  userId: string | null,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (message: string): Promise<DraftChatRow> => {
      if (!userId) throw new Error('Sign in to chat.')
      if (!leagueId) {
        // Unreachable by construction (no composer standalone). If it ever
        // becomes reachable, the room learns about it here rather than
        // writing a league-less ordinary post.
        throw new Error('A practice draft has no chat to post to.')
      }
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_chat')
        .insert({
          league_id: leagueId,
          user_id: userId, // must equal auth.uid() — the 065 policy
          message: message.trim(),
          context: draftChatContext(draftId),
          is_system: false,
        })
        .select('id, user_id, message, context, is_system, created_at')
        .single()
      if (error) throw new Error(error.message)
      return data as DraftChatRow
    },
    onSuccess: (row) => {
      const key = draftChatKeys.room(draftId)
      const rows = queryClient.getQueryData<readonly DraftChatRow[]>(key)
      if (!rows) return
      const next = reduceChatEvent(rows, row, draftChatContext(draftId))
      if (next !== rows) queryClient.setQueryData(key, next)
    },
  })
}
