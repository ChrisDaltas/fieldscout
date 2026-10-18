'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import { activityCursorFilter } from '@/lib/leagues/api/activity-service'
import { createBrowserClient } from '@/lib/supabase/client'

import type { DraftChatRow } from './use-draft-chat-ops'
import { LEAGUE_CHAT_WINDOW, boardPosts, chatCursorOf, leagueChatKeys, type LeagueChatCursor } from './use-league-chat'

/**
 * A league board's OLDER posts, a page at a time (gap list §3 #23): the
 * pages before `before` — the oldest post of the live read — newest page
 * first, each LEAGUE_CHAT_WINDOW posts. Off until there is a `before`.
 *
 * Each read takes one post more than a page, so a page knows whether there
 * is anything older without an extra, empty read; a page that holds the
 * board's first post has no next page. The boundary is the activity feed's
 * `(created_at, id) < before` (`activityCursorFilter`), so posts sharing an
 * instant are never skipped or shown twice.
 *
 * Old posts don't change, so the pages are read once (never re-read on a
 * broadcast; new posts arrive in the live read, `useLeagueChat`).
 */

export interface OlderChatPage {
  /** This page's posts, oldest first. */
  rows: DraftChatRow[]
  /** Where the next (older) page ends; null when this page reached the first post. */
  next: LeagueChatCursor | null
}

/** One older page: the posts just before `before`, oldest first. */
export async function readOlderChatPage(leagueId: string, before: LeagueChatCursor): Promise<OlderChatPage> {
  const { data, error } = await boardPosts(createBrowserClient(), leagueId)
    .or(activityCursorFilter(before.at, before.id))
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LEAGUE_CHAT_WINDOW + 1)
  if (error) throw error
  const read = (data ?? []) as DraftChatRow[]
  const page = read.slice(0, LEAGUE_CHAT_WINDOW)
  const oldest = page[page.length - 1]
  return {
    rows: page.reverse(),
    next: read.length > LEAGUE_CHAT_WINDOW && oldest ? chatCursorOf(oldest) : null,
  }
}

export function useLeagueChatOlder(leagueId: string | undefined, before: LeagueChatCursor | null) {
  return useInfiniteQuery({
    queryKey: before && leagueId ? leagueChatKeys.older(leagueId, before) : (['league-chat-older', 'off'] as const),
    enabled: Boolean(leagueId && before),
    initialPageParam: before,
    queryFn: ({ pageParam }) => readOlderChatPage(leagueId!, pageParam!),
    getNextPageParam: (last: OlderChatPage) => last.next ?? undefined,
    staleTime: Infinity,
  })
}
