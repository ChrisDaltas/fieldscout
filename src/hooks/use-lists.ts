'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query'

import type {
  CreateListInput,
  ReorderPlayersInput,
  UpdateListInput,
} from '@/types/schemas/lists'
import type { List, ListPlayer, ListTier, Player, TeamSlot } from '@/types/database'

export interface ListPlayerStats {
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  projected_pts: number | null
}

export interface ListPlayerWithPlayer extends ListPlayer {
  player: Pick<
    Player,
    'id' | 'full_name' | 'position' | 'team' | 'headshot_url' | 'status'
  > & {
    adp?: number | null
    bye_week?: number | null
    projected_pts_ppr?: number | null
    projected_pts_half_ppr?: number | null
    projected_pts_standard?: number | null
    sos?: number | null
    auction_value?: number | null
  }
  stats?: ListPlayerStats | null
}

export interface ListWithDetails extends List {
  players: ListPlayerWithPlayer[]
  tags: { id: string; name: string; slug: string; is_system_tag: boolean }[]
  /** Server-computed: is the current viewer the owner? Use this instead of a
   *  client-side auth comparison, which races with session loading. */
  is_owner: boolean
}

export interface ThumbnailPlayer {
  id: string
  full_name: string
  team: string | null
  headshot_url: string | null
  position: string | null
}

export interface ListWithTags extends List {
  tags: { id: string; name: string; slug: string; is_system_tag: boolean }[]
  first_players?: ThumbnailPlayer[]
  /** Owner profile — only populated for lists the viewer doesn't own (e.g. a
   *  pinned list belonging to someone else), so the row can show whose it is. */
  owner?: {
    username: string
    display_name: string | null
    avatar_url: string | null
  } | null
}

interface ApiListsResponse {
  lists: ListWithTags[]
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean }
}

interface ApiBigBoardResponse {
  list: List
  players: ListPlayerWithPlayer[]
}

const LISTS_KEY = ['lists'] as const

export const listsKeys = {
  all: LISTS_KEY,
  /** Prefix matching every paginated collection cache (sidebar, lists page). */
  collections: () => [...LISTS_KEY, 'collection'] as const,
  collection: (page: number, pageSize: number) =>
    [...LISTS_KEY, 'collection', page, pageSize] as const,
  detail: (id: string) => [...LISTS_KEY, 'detail', id] as const,
  bigBoard: () => [...LISTS_KEY, 'big-board'] as const,
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(body.error ?? `Request failed with ${res.status}`) as Error & {
      status: number
      code?: string
    }
    error.status = res.status
    error.code = body.code
    throw error
  }
  return (await res.json()) as T
}

// =============================================================================
// QUERIES
// =============================================================================

export function useLists(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: listsKeys.collection(page, pageSize),
    queryFn: () =>
      fetch(`/api/lists?page=${page}&pageSize=${pageSize}`).then(
        jsonOrThrow<ApiListsResponse>,
      ),
    placeholderData: keepPreviousData,
  })
}

export function useList(id: string | undefined) {
  return useQuery({
    queryKey: id ? listsKeys.detail(id) : ['lists', 'detail', 'undefined'],
    queryFn: () => fetch(`/api/lists/${id}`).then(jsonOrThrow<ListWithDetails>),
    enabled: Boolean(id),
  })
}

export function useBigBoard() {
  return useQuery({
    queryKey: listsKeys.bigBoard(),
    queryFn: () => fetch('/api/lists/big-board').then(jsonOrThrow<ApiBigBoardResponse>),
  })
}

// =============================================================================
// MUTATIONS
// =============================================================================

export function useCreateList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateListInput) =>
      fetch('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow<List>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.all })
    },
  })
}

export function useUpdateList(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateListInput) =>
      fetch(`/api/lists/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow<List>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(id) })
      qc.invalidateQueries({ queryKey: listsKeys.all })
    },
  })
}

export function useDeleteList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/lists/${id}`, { method: 'DELETE' }).then(
        jsonOrThrow<{ ok: boolean }>,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.all })
    },
  })
}

export function useDuplicateList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/lists/${id}/duplicate`, { method: 'POST' }).then(jsonOrThrow<List>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.all })
    },
  })
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/lists/${id}/favorite`, { method: 'POST' }).then(
        jsonOrThrow<{ is_favorited: boolean }>,
      ),
    // Optimistic flip across the cached collections so the sidebar updates
    // immediately. Scoped to the collection caches only — `listsKeys.all` also
    // matches the detail and big-board caches, whose shape has no `.lists`
    // array, so mapping over them would throw.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listsKeys.collections() })
      const snapshots = qc.getQueriesData<ApiListsResponse>({
        queryKey: listsKeys.collections(),
      })
      for (const [key, value] of snapshots) {
        if (!value?.lists) continue
        qc.setQueryData<ApiListsResponse>(key, {
          ...value,
          lists: value.lists.map((l) =>
            l.id === id ? { ...l, is_favorited: !l.is_favorited } : l,
          ),
        })
      }
      return { snapshots }
    },
    onError: (_err, _id, ctx) => {
      for (const [key, value] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, value)
      }
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
      qc.invalidateQueries({ queryKey: listsKeys.detail(id) })
    },
  })
}

export function useAddPlayer(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (playerId: string) =>
      fetch(`/api/lists/${listId}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      }).then(jsonOrThrow<ListPlayerWithPlayer>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      // The sidebar/list cards show player_count + the quadrant thumbnail.
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
    },
  })
}

export function useRemovePlayer(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (playerId: string) =>
      fetch(`/api/lists/${listId}/players/${playerId}`, {
        method: 'DELETE',
      }).then(jsonOrThrow<{ ok: boolean }>),

    // Optimistic remove from the cached detail
    onMutate: async (playerId) => {
      await qc.cancelQueries({ queryKey: listsKeys.detail(listId) })
      const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (prev) {
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), {
          ...prev,
          players: prev.players.filter((p) => p.player_id !== playerId),
          player_count: Math.max(0, (prev.player_count ?? 0) - 1),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listsKeys.detail(listId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      // The sidebar/list cards show player_count + the quadrant thumbnail.
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
    },
  })
}

export function useReorderPlayers(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (positions: ReorderPlayersInput['positions']) =>
      fetch(`/api/lists/${listId}/players/reorder`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions }),
      }).then(jsonOrThrow<{ ok: boolean }>),

    onMutate: async (positions) => {
      await qc.cancelQueries({ queryKey: listsKeys.detail(listId) })
      const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (prev) {
        const positionByPlayer = new Map(
          positions.map((p) => [p.playerId, p.position]),
        )
        const next = {
          ...prev,
          players: [...prev.players]
            .map((p) => ({
              ...p,
              position: positionByPlayer.get(p.player_id) ?? p.position,
              overall_rank: positionByPlayer.get(p.player_id) ?? p.overall_rank,
            }))
            .sort((a, b) => a.position - b.position),
        }
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), next)
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listsKeys.detail(listId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
    },
  })
}

export function useSetPlayerSlot(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ playerId, slot }: { playerId: string; slot: TeamSlot | null }) =>
      fetch(`/api/lists/${listId}/players/${playerId}/slot`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot }),
      }).then(jsonOrThrow<{ ok: boolean }>),
    onMutate: async ({ playerId, slot }) => {
      await qc.cancelQueries({ queryKey: listsKeys.detail(listId) })
      const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (prev) {
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), {
          ...prev,
          players: prev.players.map((p) =>
            p.player_id === playerId ? { ...p, slot } : p,
          ),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listsKeys.detail(listId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
    },
  })
}

export function useSetPlayerTier(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ playerId, tier }: { playerId: string; tier: ListTier | null }) =>
      fetch(`/api/lists/${listId}/players/${playerId}/tier`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      }).then(jsonOrThrow<{ ok: boolean }>),
    onMutate: async ({ playerId, tier }) => {
      await qc.cancelQueries({ queryKey: listsKeys.detail(listId) })
      const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (prev) {
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), {
          ...prev,
          players: prev.players.map((p) =>
            p.player_id === playerId ? { ...p, tier } : p,
          ),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listsKeys.detail(listId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
    },
  })
}

export function useToggleLike(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      fetch(`/api/lists/${listId}/like`, { method: 'POST' }).then(
        jsonOrThrow<{ liked: boolean; like_count: number }>,
      ),

    // No optimistic guess: without the prior liked state on the client the old
    // code always did +1, then corrected by -2 on an unlike — a visible
    // N → N+1 → N-1 flash. The endpoint now returns the authoritative count, so
    // we just write that exact value to the detail and any collection caches.
    onSuccess: (data) => {
      const cur = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (cur) {
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), {
          ...cur,
          like_count: data.like_count,
        })
      }
      const collections = qc.getQueriesData<ApiListsResponse>({
        queryKey: listsKeys.collections(),
      })
      for (const [key, value] of collections) {
        if (!value?.lists) continue
        qc.setQueryData<ApiListsResponse>(key, {
          ...value,
          lists: value.lists.map((l) =>
            l.id === listId ? { ...l, like_count: data.like_count } : l,
          ),
        })
      }
    },
  })
}

export type { ListTier }
