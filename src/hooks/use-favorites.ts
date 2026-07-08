'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// The Favorites list — the players table's quick-save. One shared query holds
// the favorited player-id set so every pin button stays in sync; the toggle
// mutation flips optimistically and rolls back on error. Backed by
// /api/lists/favorites (get-or-create + toggle server-side).

export const favoritesKeys = {
  all: ['favorites'] as const,
  playerSet: () => ['favorites', 'player-set'] as const,
}

export function useFavoritePlayerIds() {
  return useQuery({
    queryKey: favoritesKeys.playerSet(),
    queryFn: async (): Promise<Set<string>> => {
      const res = await fetch('/api/lists/favorites')
      if (!res.ok) throw new Error('Failed to load favorites')
      const data = (await res.json()) as { playerIds: string[] }
      return new Set(data.playerIds)
    },
    staleTime: 30_000,
  })
}

interface ToggleVars {
  playerId: string
  /** Current state — the mutation flips it. */
  favorited: boolean
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  const key = favoritesKeys.playerSet()

  return useMutation({
    mutationFn: async ({ playerId }: ToggleVars) => {
      const res = await fetch('/api/lists/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      })
      if (!res.ok) throw new Error('Could not update favorites')
      return (await res.json()) as { favorited: boolean }
    },
    onMutate: async ({ playerId, favorited }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Set<string>>(key)
      const next = new Set(prev ?? [])
      if (favorited) next.delete(playerId)
      else next.add(playerId)
      qc.setQueryData(key, next)
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: favoritesKeys.all })
      // The Favorites list gained/lost a player — refresh the lists caches.
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })
}
