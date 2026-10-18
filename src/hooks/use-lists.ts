'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  CreateListInput,
  ReorderPlayersInput,
  UpdateListInput,
} from '@/types/schemas/lists'
import type { ListLink } from '@/lib/lists/links-service'
import type { List, ListPlayer, ListTier, Player, TeamSlot } from '@/types/database'
import type { ListBucketKey } from '@/types/schemas/lists'

export type { ListLink }

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
  /** Server-computed: has the viewer liked it? `null` when that couldn't be
   *  read (the Like then waits for the toggle's answer); absent on a list
   *  built somewhere other than `/api/lists/[id]` (the share page). */
  is_liked?: boolean | null
  /** Attached links (migration 080), already in the owner's chosen order.
   *  Embedded by `/api/lists/[id]` rather than fetched separately — and a
   *  failed links query 500s that route, so `[]` here always means "none
   *  attached" and never "the query broke". */
  links: ListLink[]
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
    /**
     * **A 404 is an answer, not a hiccup** — `use-draft-mode.ts`:518's rule,
     * narrowed to the one status that is definitive (LV.17; corrected by
     * **R249** and **R252**).
     *
     * ## What this line is for, stated truthfully
     *
     * The app-wide default is `retry: 1` (`query-provider.tsx`), and while a
     * retry is outstanding TanStack Query keeps the **last good data** and
     * reports the failure only through `failureReason` — so a surface reading
     * `isError` goes on rendering the vanished list's rows until the retry is
     * exhausted. **A 404 surfaced one retry late, and a shared hook was changed
     * to make it immediate.** That is the whole claim.
     *
     * **The stronger claim this shipped with was false, and R249 is right to
     * strike it.** It said the state was *"not reachable at all"*, on an
     * observation of `fetchStatus: 'paused'`. Re-run against this repo's own
     * `@tanstack/react-query` — one successful read, then every read 404s —
     * `retry: 1` reaches `status: 'error'` after **3** `queryFn` calls and
     * no-retry after **2**, with `data` retained in both. `paused` is React
     * Query's **offline** state (`networkMode: 'online'`), which a resolved HTTP
     * 404 does not produce; it was recorded as the finding rather than
     * diagnosed. The change stands on being immediate, not on being the only way
     * through.
     *
     * ## Why 404 and not `< 500` (**R252**)
     *
     * `< 500` was materially wider than the argument for it. This same route
     * answers 401/403/400 on `PATCH`/`DELETE` (`route.ts`:147, 176, 302, 319),
     * and 408/429 are canonically retryable — none of those is *"there is
     * nothing here"*. Only 404 is definitive for a read: the route's
     * `.is('deleted_at', null)` filter returns no row for a deleted list, a
     * missing id, **or one that is no longer visible to this viewer**
     * (`listReadIsGone` in `list-row-parts.tsx` carries that correction). All
     * three are settled facts; retrying only delays them. Everything else keeps
     * the single retry the rest of the app gets.
     */
    retry: (failureCount: number, error: Error) => {
      const status = (error as Error & { status?: number }).status
      if (status === 404) return false
      return failureCount < 1
    },
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

/**
 * Move a player into a bucket, or out of one with `null`.
 *
 * `ListBucketKey`, not `ListTier`: since LV.1.5 the column and the route accept
 * rounds `r1`–`r30` and cost bands `c1`–`c4` alongside the S–F letters (plan
 * **D4**, migration `081_list_players_tier_vocabulary.sql`). The narrower type
 * was the compile-time half of the old refusal and would now reject a legal
 * write.
 */
export function useSetPlayerTier(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ playerId, tier }: { playerId: string; tier: ListBucketKey | null }) =>
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

/**
 * The like toggle's options, on a given client — `useToggleLike` is this
 * plus `useMutation`; tests drive it through a `MutationObserver`.
 *
 * Optimistic only where the viewer's liked state is known: the list's detail
 * cache carrying `is_liked` (`/api/lists/[id]`) flips at once and its count
 * moves by one (CLAUDE.md: like/unlike are optimistic), and a failure puts it
 * back. Anywhere else — a feed row, a detail whose like couldn't be read —
 * nothing is guessed: without the prior state the old code always did +1,
 * then corrected by -2 on an unlike, a visible N → N+1 → N-1 flash. Either
 * way the endpoint's answer (its liked state and authoritative count) is
 * written last, to the detail and any collection caches.
 */
export function toggleLikeMutationOptions(qc: QueryClient, listId: string) {
  const detailKey = listsKeys.detail(listId)
  return {
    mutationFn: () =>
      fetch(`/api/lists/${listId}/like`, { method: 'POST' }).then(
        jsonOrThrow<{ liked: boolean; like_count: number }>,
      ),

    onMutate: async (): Promise<{ prev: ListWithDetails | undefined }> => {
      const known = qc.getQueryData<ListWithDetails>(detailKey)
      if (typeof known?.is_liked !== 'boolean') return { prev: undefined }
      // Only a loaded detail is cancelled (an in-flight refetch would land
      // over the guess); its data is what's read back.
      await qc.cancelQueries({ queryKey: detailKey })
      const prev = qc.getQueryData<ListWithDetails>(detailKey)
      if (!prev) return { prev: undefined }
      const liked = !prev.is_liked
      qc.setQueryData<ListWithDetails>(detailKey, {
        ...prev,
        is_liked: liked,
        like_count: Math.max(0, (prev.like_count ?? 0) + (liked ? 1 : -1)),
      })
      return { prev }
    },

    onError: (_err: Error, _vars: void, ctx: { prev: ListWithDetails | undefined } | undefined) => {
      if (ctx?.prev) qc.setQueryData<ListWithDetails>(detailKey, ctx.prev)
    },

    onSuccess: (data: { liked: boolean; like_count: number }) => {
      const cur = qc.getQueryData<ListWithDetails>(detailKey)
      if (cur) {
        qc.setQueryData<ListWithDetails>(detailKey, {
          ...cur,
          is_liked: data.liked,
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
  }
}

export function useToggleLike(listId: string) {
  const qc = useQueryClient()
  return useMutation(toggleLikeMutationOptions(qc, listId))
}

// =============================================================================
// ATTACHED LINKS (migration 080 — Chris's 2026-08-11 ruling: attribution back
// to the resources a list drew on, plus a creator's own video)
// =============================================================================

/**
 * Every links mutation answers with the list's FULL resulting order, so the
 * cache is written from the server's truth rather than patched from a guess.
 * That is on purpose: `addLink` computes `position` from `max + 1`, and a
 * reorder can be refused outright as a set mismatch — an optimistic local
 * splice would be a second, divergent opinion about the order. Links are a
 * handful of rows behind a deliberate click, so there is nothing to gain from
 * optimism and a real inconsistency to lose. (Contrast the drafted checkbox,
 * which IS optimistic — it is tapped continuously during a live draft.)
 */
interface LinksResponse {
  list_id: string
  links: ListLink[]
}

function writeLinks(
  qc: ReturnType<typeof useQueryClient>,
  listId: string,
  links: ListLink[],
): void {
  const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
  if (prev) qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), { ...prev, links })
}

export interface AddLinkInput {
  kind: 'video' | 'article'
  url: string
  title: string
  source_label?: string | null
  duration_label?: string | null
}

export function useAddLink(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddLinkInput) =>
      fetch(`/api/lists/${listId}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow<LinksResponse & { link: ListLink }>),
    onSuccess: (data) => writeLinks(qc, listId, data.links),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
    },
  })
}

export function useRemoveLink(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) =>
      fetch(`/api/lists/${listId}/links/${linkId}`, { method: 'DELETE' }).then(
        jsonOrThrow<LinksResponse & { removed: boolean; link_id: string }>,
      ),
    onSuccess: (data) => writeLinks(qc, listId, data.links),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
    },
  })
}

/**
 * There is deliberately **no `useReorderLinks`**. `PATCH /api/lists/[id]/links`
 * exists and is proven at the stack layer, but the reference screen shows no
 * reorder affordance on a link card — no handle, no arrows — and inventing one
 * would be UI the design LAW does not ask for. The client half lands with
 * **LV.4** (drag-and-drop), which owns the gap model these cards would use.
 * Shipping an unused hook now would just be dead code with a plausible name.
 */

export type { ListTier }
