'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { boardRows, olderState, type OlderState } from '@/components/mobile/messages/messages-ops'

import type { DraftChatRow } from './use-draft-chat-ops'
import { LEAGUE_CHAT_WINDOW, boardMeetsFrom, chatCursorOf, useLeagueChat, type LeagueChatCursor } from './use-league-chat'
import { useLeagueChatOlder } from './use-league-chat-older'

export interface MobileLeagueBoard {
  /** Every post loaded, oldest first; undefined until the first read lands. */
  rows: DraftChatRow[] | undefined
  isPending: boolean
  isError: boolean
  refetch: () => unknown
  older: { state: OlderState; load: () => void }
}

/**
 * FieldScout Mobile — a league board as its Messages thread shows it, with
 * older posts loading as you scroll up (gap list §3 #23 — it used to stop at
 * the latest 30, silently).
 *
 * It opens on the latest window every board card shows. The first time the
 * reader nears the top of a FULL window, its oldest post becomes `from`:
 * from then on the live read is every post from `from` on (still live), and
 * the older pages are read back from just before it, a page at a time. The
 * two always meet at `from`, however many posts arrive meanwhile — until
 * more arrive than one live read takes; then the board starts over from the
 * latest window rather than show a hole.
 */
export function useMobileLeagueBoard(leagueId: string): MobileLeagueBoard {
  const [from, setFrom] = useState<LeagueChatCursor | null>(null)
  const live = useLeagueChat(leagueId, { from })
  const older = useLeagueChatOlder(leagueId, from)

  const broken = from !== null && live.data !== undefined && !boardMeetsFrom(live.data, from)
  useEffect(() => {
    if (broken) setFrom(null)
  }, [broken])

  const paging = from !== null && !broken
  const rows = useMemo(() => (paging ? boardRows(older.data?.pages, live.data) : live.data), [paging, older.data, live.data])

  const state = olderState({
    paging,
    windowFull: (live.data?.length ?? 0) >= LEAGUE_CHAT_WINDOW,
    pending: older.isPending,
    fetching: older.isFetching,
    error: older.isError,
    hasMore: older.hasNextPage,
  })

  const first = live.data?.[0]
  const { refetch: refetchOlder, fetchNextPage, data: olderData } = older
  const load = useCallback(() => {
    if (state === 'idle' && !paging) {
      const cursor = first ? chatCursorOf(first) : null
      if (cursor) setFrom(cursor)
    } else if (state === 'idle' || state === 'error') {
      void (olderData ? fetchNextPage() : refetchOlder())
    }
  }, [state, paging, first, olderData, fetchNextPage, refetchOlder])

  return {
    rows,
    isPending: live.isPending,
    isError: live.isError,
    refetch: live.refetch,
    older: { state, load },
  }
}
