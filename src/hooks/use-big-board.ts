'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { listsKeys } from '@/hooks/use-lists'
import type { ListPlayer, List, Player } from '@/types/database'

export interface BigBoardPlayerEntry extends ListPlayer {
  player: Pick<
    Player,
    'id' | 'full_name' | 'position' | 'team' | 'headshot_url' | 'status'
  > & { adp?: number | null }
}

export interface BigBoardSnapshotPlayer {
  player_id: string
  position: number
  full_name: string
  position_code: string
  team: string | null
  headshot_url: string | null
}

export interface BigBoardSnapshotSummary {
  id: string
  saved_at: string
  player_count: number
}

export interface BigBoardSnapshotDetail {
  id: string
  saved_at: string
  snapshot_data: BigBoardSnapshotPlayer[]
}

export interface WeeklyBigBoardResponse {
  week: number
  season: number
  list: List
  players: BigBoardPlayerEntry[]
  created: boolean
}

const bigBoardKeys = {
  all: ['big-board'] as const,
  history: () => ['big-board', 'history'] as const,
  week: (week: number) => ['big-board', 'week', week] as const,
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return (await res.json()) as T
}

export function useBigBoardHistory() {
  return useQuery({
    queryKey: bigBoardKeys.history(),
    queryFn: () =>
      fetch('/api/big-board/history').then(
        jsonOrThrow<{ snapshots: BigBoardSnapshotSummary[] }>,
      ),
  })
}

export function useRestoreSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) =>
      fetch(`/api/big-board/restore/${snapshotId}`, {
        method: 'POST',
      }).then(jsonOrThrow<BigBoardSnapshotDetail>),
    // Restoring replaces the Big Board's working set — refresh it and the
    // history/weekly views, which previously stayed stale until a manual reload.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      qc.invalidateQueries({ queryKey: bigBoardKeys.all })
    },
  })
}

interface SaveBigBoardArgs {
  /**
   * Ordered player IDs for the working set. The server fully replaces the
   * Big Board's players with this list and inserts a snapshot row.
   */
  playerIds: string[]
}

export function useSaveBigBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ playerIds }: SaveBigBoardArgs) =>
      fetch('/api/big-board/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerIds }),
      }).then(
        jsonOrThrow<{
          ok: boolean
          snapshot?: { id: string; saved_at: string }
          snapshotError?: string
        }>,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      qc.invalidateQueries({ queryKey: bigBoardKeys.history() })
    },
  })
}

export function useWeeklyBigBoard(weekNumber: number) {
  return useQuery({
    queryKey: bigBoardKeys.week(weekNumber),
    queryFn: () =>
      fetch(`/api/big-board/week/${weekNumber}`).then(
        jsonOrThrow<WeeklyBigBoardResponse>,
      ),
    enabled: Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= 18,
  })
}

export { bigBoardKeys }
