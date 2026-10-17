'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  planIsEmpty,
  planSave,
  type ListDraft,
  type SavePlan,
} from '@/components/mobile/lists/lists-model'
import { listsKeys, type ListWithDetails } from '@/hooks/use-lists'

/**
 * FieldScout Mobile — Lists: Update, the list editor's one write (Chris,
 * 2026-10-15, gap list #16). The editor keeps a draft; this writes the whole
 * draft through the routes the app already uses, each with its own server
 * checks:
 *
 *   1. remove players   `DELETE …/players/[playerId]` (one per player)
 *   2. add players      `POST …/players/bulk` (one insert, all or nothing)
 *   3. tiers            `PATCH …/players/[playerId]/tier` (one per player)
 *   4. order            `PATCH …/players/reorder` (one RPC, all or nothing)
 *   5. name + Ranked / Tiers  `PATCH /api/lists/[id]` (one update)
 *
 * ## Not atomic, so: a safe order, then a re-read
 *
 * No route writes all of that at once, and this run adds no endpoint, so an
 * Update is several requests. They go in the order above — players leave
 * and arrive before anything refers to them, and the Ranked / Tiers switch
 * lands last, so a tiered view never shows before its tiers do. The first
 * step that fails stops the rest.
 *
 * The plan is made against a fresh read of the list (not the screen's
 * cache), and once the writes are done — or one has failed — the list is
 * read again and compared with the draft. Only an empty difference is a
 * save: a request that "succeeded" without its change sticking is reported,
 * not trusted (CLAUDE.md, "nothing happened" ≠ "it worked"). On a failure
 * the caller gets what was attempted and what is still unsaved, keeps the
 * draft, and a second Update writes only what is left — or, when everything
 * had in fact landed, finds nothing left and reports the save.
 *
 * ## Only the user's changes
 *
 * Both comparisons measure the draft against its `base` — the list as it
 * stood when editing began — and apply only what the user changed onto the
 * list as it is now (`planSave`). A player added to the list on desktop after
 * the editor opened is kept (and placed after the draft's players if the
 * user reordered), never removed as if the user had dropped him; a tier,
 * name or removal made elsewhere is likewise left alone.
 */

export type CommitOutcome =
  | { ok: true; list: ListWithDetails }
  | {
      ok: false
      error: string
      /** The writes tried; `null` when nothing was sent. */
      attempted: SavePlan | null
      /** What still differs after the re-read; `null` when it failed. */
      remaining: SavePlan | null
      /** The re-read list, when there is one. */
      list: ListWithDetails | null
    }

type Fetch = typeof fetch

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function ok(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  const body = (await res.json().catch(() => ({}))) as { error?: unknown }
  const detail = typeof body.error === 'string' ? body.error : `request failed with ${res.status}`
  throw new Error(`${what}: ${detail}`)
}

export async function readList(listId: string, f: Fetch = fetch): Promise<ListWithDetails> {
  // Never a cached copy: this read is what decides whether the save stuck.
  const res = await ok(await f(`/api/lists/${listId}`, { cache: 'no-store' }), 'Could not read the list')
  return (await res.json()) as ListWithDetails
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** Run requests side by side; throw the first failure once all have settled. */
async function all(requests: ReadonlyArray<Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(requests)
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
}

/** Send a plan's writes in the safe order; the first failing step throws. */
export async function writePlan(listId: string, plan: SavePlan, f: Fetch = fetch): Promise<void> {
  const base = `/api/lists/${listId}`
  if (plan.remove.length > 0) {
    await all(
      plan.remove.map(async (playerId) =>
        ok(await f(`${base}/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' }), 'Could not remove a player'),
      ),
    )
  }
  if (plan.add.length > 0) {
    await ok(await f(`${base}/players/bulk`, json('POST', { player_ids: plan.add })), 'Could not add the players')
  }
  if (plan.tiers.length > 0) {
    await all(
      plan.tiers.map(async ({ playerId, tier }) =>
        ok(await f(`${base}/players/${encodeURIComponent(playerId)}/tier`, json('PATCH', { tier })), 'Could not set a tier'),
      ),
    )
  }
  if (plan.order && plan.order.length > 0) {
    const positions = plan.order.map((playerId, index) => ({ playerId, position: index + 1 }))
    await ok(await f(`${base}/players/reorder`, json('PATCH', { positions })), 'Could not save the order')
  }
  if (Object.keys(plan.fields).length > 0) {
    await ok(await f(base, json('PATCH', plan.fields)), 'Could not save the name or Ranked / Tiers')
  }
}

/** Write the draft, then check it against a re-read of the list. Never throws. */
export async function commitDraft(listId: string, draft: ListDraft, f: Fetch = fetch): Promise<CommitOutcome> {
  let before: ListWithDetails
  try {
    before = await readList(listId, f)
  } catch (error) {
    return { ok: false, error: message(error), attempted: null, remaining: null, list: null }
  }
  const attempted = planSave(draft, before)
  if (planIsEmpty(attempted)) return { ok: true, list: before }

  let failure: string | null = null
  try {
    await writePlan(listId, attempted, f)
  } catch (error) {
    failure = message(error)
  }

  let after: ListWithDetails
  try {
    after = await readList(listId, f)
  } catch (error) {
    return {
      ok: false,
      error: failure ?? `The changes were sent, but ${message(error).replace(/^Could not/, 'could not')}.`,
      attempted,
      remaining: null,
      list: null,
    }
  }
  const remaining = planSave(draft, after)
  if (!failure && planIsEmpty(remaining)) return { ok: true, list: after }
  return {
    ok: false,
    // Every request said OK, yet the list still differs from the draft.
    error: failure ?? 'Some changes didn’t stick.',
    attempted,
    remaining,
    list: after,
  }
}

export function useMobileListsCommit(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (draft: ListDraft) => commitDraft(listId, draft),
    onSettled: (outcome) => {
      // The re-read is the list as it now stands; without one, read again.
      if (outcome?.list) qc.setQueryData(listsKeys.detail(listId), outcome.list)
      else qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
    },
  })
}
