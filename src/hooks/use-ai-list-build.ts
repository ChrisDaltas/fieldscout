'use client'

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import {
  listsKeys,
  type ListPlayerWithPlayer,
  type ListWithDetails,
} from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'
import { useAiBuildStore } from '@/stores/ai-build-store'
import type { GenerateListResponse } from '@/types/schemas/ai'

/**
 * Runs the AI build show on the List Detail page. The generate modal creates
 * an empty list, queues a job in useAiBuildStore, and navigates here; this
 * hook claims the job and:
 *
 *   1. generating — calls POST /api/lists/generate (the slow Claude call)
 *   2. adding     — persists players one at a time, shuffled and staggered,
 *                   appending each to the React Query cache so the user
 *                   watches the roster fill in
 *   3. ordering   — steps the cached rows into the AI's rank order (pure
 *                   theatre), then persists the final order in one PATCH
 *
 * The loop keeps running if the user navigates away (the store and query
 * cache are app-level); dismissing the banner or starting a new build stops
 * it at the next checkpoint.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The loop's cancellation check: is this still the active job? */
const isActive = (listId: string) =>
  useAiBuildStore.getState().job?.listId === listId

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Reveal pacing — savor small boards, keep 50-player boards under ~8s. */
const addStagger = (total: number) => (total <= 10 ? 350 : total <= 25 ? 180 : 60)

function patchDetailCache(
  qc: QueryClient,
  listId: string,
  update: (prev: ListWithDetails) => ListWithDetails,
) {
  const key = listsKeys.detail(listId)
  const prev = qc.getQueryData<ListWithDetails>(key)
  if (prev) qc.setQueryData<ListWithDetails>(key, update(prev))
}

function appendPlayerToCache(
  qc: QueryClient,
  listId: string,
  row: ListPlayerWithPlayer,
) {
  patchDetailCache(qc, listId, (prev) =>
    prev.players.some((p) => p.player_id === row.player_id)
      ? prev
      : {
          ...prev,
          players: [...prev.players, row],
          player_count: prev.players.length + 1,
        },
  )
}

function movePlayerToIndex(
  qc: QueryClient,
  listId: string,
  playerId: string,
  index: number,
) {
  patchDetailCache(qc, listId, (prev) => {
    const from = prev.players.findIndex((p) => p.player_id === playerId)
    if (from < 0 || from === index) return prev
    const players = [...prev.players]
    const [moved] = players.splice(from, 1)
    players.splice(index, 0, moved)
    return { ...prev, players }
  })
}

async function runBuild(listId: string, qc: QueryClient) {
  const store = useAiBuildStore.getState
  const job = store().job
  if (!job || job.listId !== listId) return

  // -- 1. Generate (a retry that already has the proposal skips this) --------
  let result = job.result
  if (!result) {
    let res: Response
    try {
      res = await fetch('/api/lists/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job.request),
      })
    } catch {
      store().fail(listId, 'Generation failed. Check your connection and retry.')
      return
    }
    if (!isActive(listId)) return
    if (res.status === 402) {
      store().fail(
        listId,
        'AI list generation is a FieldScout Pro feature. This list is still yours to fill in by hand.',
        { upgradeRequired: true },
      )
      return
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      store().fail(
        listId,
        typeof body?.error === 'string' ? body.error : 'Generation failed. Retry in a moment.',
      )
      return
    }
    result = (await res.json()) as GenerateListResponse
    if (!isActive(listId)) return
    store().setResult(listId, result)
  }

  // The reveal writes into the detail cache the page's useList query owns —
  // give that first fetch a bounded moment to land.
  for (let i = 0; i < 40 && !qc.getQueryData(listsKeys.detail(listId)); i++) {
    await sleep(150)
    if (!isActive(listId)) return
  }

  // Retitle for what actually came back (resolution can drop players) and
  // adopt the AI's style note as the description. Cosmetic — failure is fine.
  const title = `${result.style} ${result.position} Top ${result.players.length}`.slice(0, 100)
  const description = result.style_note.slice(0, 500)
  void fetch(`/api/lists/${listId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, description }),
  }).catch(() => {})
  patchDetailCache(qc, listId, (prev) => ({ ...prev, title, description }))

  // -- 2. Add players, deliberately out of order, one visible row at a time --
  store().setPhase(listId, 'adding')
  const added = new Set(store().job?.addedIds ?? [])
  const stagger = addStagger(result.players.length)
  for (const player of shuffle(result.players)) {
    if (!isActive(listId)) return
    if (added.has(player.player_id)) continue
    try {
      const res = await fetch(`/api/lists/${listId}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          player_id: player.player_id,
          notes: player.rationale.slice(0, 280),
        }),
      })
      if (res.ok) {
        const row = (await res.json()) as ListPlayerWithPlayer
        added.add(player.player_id)
        store().markAdded(listId, player.player_id)
        appendPlayerToCache(qc, listId, row)
      } else if (res.status === 409) {
        // Already on the list (a resumed build) — count it and move on.
        added.add(player.player_id)
        store().markAdded(listId, player.player_id)
      }
      // Other statuses: skip this player; the shortfall lands in the toast.
    } catch {
      // One flaky request shouldn't sink the board — keep going.
    }
    await sleep(stagger)
  }

  // -- 3. Order: walk the board top-down, pulling each player into rank ------
  store().setPhase(listId, 'ordering')
  await sleep(650)
  const finalOrder = [...result.players]
    .sort((a, b) => a.rank - b.rank)
    .filter((p) => added.has(p.player_id))
  const step = Math.min(320, Math.max(110, Math.floor(3500 / Math.max(finalOrder.length, 1))))
  for (let i = 0; i < finalOrder.length; i++) {
    if (!isActive(listId)) return
    movePlayerToIndex(qc, listId, finalOrder[i].player_id, i)
    await sleep(step)
  }

  // The sort above was cache-only theatre; persist the order in one write.
  if (finalOrder.length > 0) {
    const res = await fetch(`/api/lists/${listId}/players/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        positions: finalOrder.map((p, i) => ({ playerId: p.player_id, position: i + 1 })),
      }),
    }).catch(() => null)
    if (!isActive(listId)) return
    if (!res || !res.ok) {
      store().fail(listId, 'The players are in, but the order could not be saved. Retry to finish.')
      return
    }
  }

  // -- Done -------------------------------------------------------------------
  const missing = result.players.length - finalOrder.length
  const skipped =
    result.unresolved.length > 0
      ? ` Skipped ${result.unresolved.length} unrecognized ${result.unresolved.length === 1 ? 'name' : 'names'}.`
      : ''
  toast(
    missing > 0
      ? {
          title: 'List built with warnings',
          description: `${finalOrder.length} of ${result.players.length} players made it — add the rest by hand.${skipped}`,
          variant: 'destructive',
        }
      : {
          title: 'List built',
          description: `${finalOrder.length} players, ranked by AI. Fully editable.${skipped}`,
        },
  )
  store().clear()
  qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
  qc.invalidateQueries({ queryKey: listsKeys.collections() })
}

export function useAiListBuild(listId: string) {
  const qc = useQueryClient()
  const job = useAiBuildStore((s) => (s.job?.listId === listId ? s.job : null))
  const retry = useAiBuildStore((s) => s.retry)
  const dismiss = useAiBuildStore((s) => s.clear)

  useEffect(() => {
    if (!job || job.phase !== 'pending') return
    // claim() flips pending → generating exactly once, so StrictMode's double
    // effect (and a retry racing a rerender) can't start two loops.
    if (!useAiBuildStore.getState().claim(listId)) return
    void runBuild(listId, qc)
  }, [job, listId, qc])

  return {
    job,
    retry,
    dismiss,
    /** True while the AI owns the list — the page should render read-only. */
    building: Boolean(job && job.phase !== 'error'),
  }
}
