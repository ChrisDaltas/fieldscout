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
 *
 * TWO READS (gap list §3 #23). By default the latest-N window every board
 * card shows. Given `from` — the oldest post of that window, once a phone
 * reader scrolls up for older posts (`useMobileLeagueBoard`) — it reads
 * every post from there on instead, so the older pages
 * (`useLeagueChatOlder`, which end just before `from`) always meet it: a
 * window that slid forward as new posts arrived would open a hole between
 * them. Both reads share the `board` key prefix, so a broadcast or a send
 * re-reads either.
 */

/** Latest-N window the board renders (ascending). A window, not the table. */
export const LEAGUE_CHAT_WINDOW = 30

/**
 * The most a `from` read takes. PostgREST would cut a bigger read silently,
 * so this read is bounded on purpose and a full one is recognised: it is
 * read newest-first, and once it no longer reaches `from` the board starts
 * over from the latest window (`boardMeetsFrom`) — never a silent hole.
 */
export const LEAGUE_CHAT_SINCE_MAX = 200

/** The columns a board read takes (the D109(2) broadcast payload). */
export const LEAGUE_CHAT_COLUMNS = 'id, user_id, message, context, is_system, created_at'

/** A place in the board: a post's instant and id — the read's total order
 *  (`created_at`, then `id`), so posts sharing an instant are never skipped. */
export interface LeagueChatCursor {
  at: string
  id: string
}

export const leagueChatKeys = {
  board: (leagueId: string) => ['league-chat', leagueId] as const,
  /** Every post from `from` on — under `board`, so it is re-read live. */
  since: (leagueId: string, from: LeagueChatCursor) => ['league-chat', leagueId, 'since', from.at, from.id] as const,
  /** Pages before `before` — NOT under `board`: old posts don't change, so a
   *  broadcast re-reads only the live end, never every page scrolled back. */
  older: (leagueId: string, before: LeagueChatCursor) => ['league-chat-older', leagueId, before.at, before.id] as const,
}

/** A post as a cursor (null when it carries no instant to page by). */
export function chatCursorOf(row: Pick<DraftChatRow, 'id' | 'created_at'>): LeagueChatCursor | null {
  return row.created_at ? { at: row.created_at, id: row.id } : null
}

/**
 * `(created_at, id) >= from`, as PostgREST spells it — the exact inverse of
 * the older pages' `activityCursorFilter` boundary, so the post AT `from`
 * belongs to this read and every older one to the pages. Values are
 * double-quoted: a timestamptz carries `.`, `:` and `+`.
 */
export function chatSinceFilter(from: LeagueChatCursor): string {
  return `created_at.gt."${from.at}",and(created_at.eq."${from.at}",id.gte."${from.id}")`
}

/** Whether a `from` read still reaches `from` — its oldest post IS that post.
 *  A read that came back full stops short of it (posts in between are
 *  missing), and so does one that lost it. */
export function boardMeetsFrom(rows: readonly Pick<DraftChatRow, 'id'>[], from: LeagueChatCursor): boolean {
  return rows[0]?.id === from.id
}

/** The part of an (ascending) window from `from` on — what a `from` read
 *  starts out holding; undefined when the window doesn't hold `from`. */
export function windowFrom<T extends Pick<DraftChatRow, 'id'>>(rows: readonly T[] | undefined, from: LeagueChatCursor): T[] | undefined {
  const i = rows?.findIndex((r) => r.id === from.id) ?? -1
  return rows && i >= 0 ? rows.slice(i) : undefined
}

/** A league's member board posts, before any order or bound. */
export function boardPosts(supabase: ReturnType<typeof createBrowserClient>, leagueId: string) {
  return supabase
    .from('league_chat')
    .select(LEAGUE_CHAT_COLUMNS)
    .eq('league_id', leagueId)
    .eq('context', 'league')
    .eq('is_system', false)
}

/** The live read, ascending: the latest window, or every post from `from`. */
export async function readLeagueChat(leagueId: string, from: LeagueChatCursor | null): Promise<DraftChatRow[]> {
  const base = boardPosts(createBrowserClient(), leagueId)
  const { data, error } = await (from ? base.or(chatSinceFilter(from)) : base)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(from ? LEAGUE_CHAT_SINCE_MAX : LEAGUE_CHAT_WINDOW)
  if (error) throw error
  return ((data ?? []) as DraftChatRow[]).reverse()
}

export function useLeagueChat(leagueId: string | undefined, options: { from?: LeagueChatCursor | null } = {}) {
  const from = options.from ?? null
  const queryClient = useQueryClient()
  const board = leagueChatKeys.board(leagueId ?? 'none')
  const query = useQuery({
    queryKey: from ? leagueChatKeys.since(leagueId ?? 'none', from) : board,
    enabled: Boolean(leagueId),
    queryFn: () => readLeagueChat(leagueId!, from),
    // Switching to the `from` read starts from the window already on screen
    // (`from` is its oldest post), so nothing flashes or reloads.
    ...(from
      ? {
          initialData: () => windowFrom(queryClient.getQueryData<DraftChatRow[]>(board), from),
          initialDataUpdatedAt: () => queryClient.getQueryState(board)?.dataUpdatedAt,
        }
      : {}),
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
        .select(LEAGUE_CHAT_COLUMNS)
        .single()
      if (error) throw new Error(error.message)
      return data as DraftChatRow
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leagueChatKeys.board(leagueId) })
    },
  })
}
