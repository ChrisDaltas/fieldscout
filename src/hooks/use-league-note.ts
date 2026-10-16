'use client'

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueNoteView, SetLeagueNoteResult } from '@/lib/leagues/api/league-note-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'

/**
 * The commissioner note (gap list #13; migration 192) —
 * `GET / POST /api/leagues/[id]/commish/note`.
 *
 * The read is any member's; the write is the commissioner's (or a
 * co-commissioner's) and is NOT optimistic and NOT retried: the server trims,
 * caps, writes the receipt and notifies the league, so the note shown after
 * a save is always the server's. Success and failure both re-read the note,
 * the commissioner log and the activity feed (the change is listed there).
 */

export const leagueNoteKeys = {
  detail: (leagueId: string) => ['league-note', leagueId] as const,
}

export type { LeagueNoteView, SetLeagueNoteResult }

export function useLeagueNote(leagueId: string | undefined) {
  return useQuery({
    queryKey: leagueNoteKeys.detail(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<LeagueNoteView>(`/api/leagues/${leagueId!}/commish/note`),
    staleTime: 60_000,
  })
}

/** Everything a note change shows up in. */
export function rereadAfterNoteChange(queryClient: QueryClient, leagueId: string): void {
  void queryClient.invalidateQueries({ queryKey: leagueNoteKeys.detail(leagueId) })
  void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
}

export interface SetLeagueNoteVariables {
  /** The note as typed; blank clears it. */
  note: string
  /** Optional (Q66). */
  reason?: string
}

export function useSetLeagueNote(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation<SetLeagueNoteResult, Error, SetLeagueNoteVariables>({
    retry: false,
    mutationFn: ({ note, reason }) =>
      sendLeagueAction<SetLeagueNoteResult>(
        `/api/leagues/${leagueId}/commish/note`,
        jsonInit('POST', { note, ...(reason !== undefined && reason.trim() !== '' ? { reason } : {}) }),
      ),
    onSettled: () => rereadAfterNoteChange(queryClient, leagueId),
  })
}
