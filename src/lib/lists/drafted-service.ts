/**
 * Drafted-marks service — Lists v2 task **LV.1.2**, design decision **D2**
 * (delivery-plan-lists-v2.md v3.3 §2.2/§3). The server side of "cross out the
 * players who are already gone", backed by migration 079's
 * `list_player_drafted`.
 *
 * D2 is the ceiling on this file: *"marking as drafted should be nothing more
 * than telling the UI to display that player differently in that list."* Row
 * presence is the whole state. Nothing here reorders, filters, cascades to
 * other lists, touches rank, or writes to `lists` / `list_players`.
 *
 * Layering follows the house pattern the leagues build established (thin
 * Route Handler over an INJECTED Supabase client): `src/app/api/lists/[id]/
 * drafted/route.ts` is a wrapper, and everything decidable lives here so the
 * stack suite (`drafted-api-db.test.ts`) can drive the production composition
 * over real PostgREST with real signed-in users. The lists routes that
 * predate Lists v2 inline their logic; this one does not, because the LV.1.2
 * DoD requires the RLS isolation to be proven through the code that actually
 * ships.
 *
 * 079's RLS is the ENFORCEMENT backstop; this layer's job is friendly,
 * SPECIFIC 4xxs. Every "nothing happened" answer here is required to carry
 * its reason (CLAUDE.md — an empty result must never be indistinguishable
 * from an error):
 *   - unreadable / soft-deleted / nonexistent list  → 404, never `[]`
 *   - player not on the list                        → 404 with the reason,
 *     never a stored mark nothing will ever render
 *   - a read that errored                           → 500, never `{drafted: []}`
 *   - already in the requested state                → 200 with `changed:
 *     false`, so the caller can tell a no-op from a write
 *   - a DELETE that RLS filtered away because the caller does not speak for
 *     `userId`                                      → 403, never a cheerful
 *     `changed: false` (R175 — see `assertCallerIs`)
 *   - a READ that RLS filtered away for the same reason
 *                                                   → 403, never a cheerful
 *     `{drafted: []}` (R176, folded in at LV.1.3 — the read path had the same
 *     reachability as the un-mark path and none of its honesty)
 *
 * **The write takes an explicit desired state, not a blind toggle.** The plan
 * calls LV.1.2 "the read/toggle route", which names the user's gesture; the
 * wire contract is `{player_id, drafted: boolean}` because a checkbox with an
 * optimistic update retries, and a blind toggle applied twice lands on the
 * wrong answer with no way to notice. Explicit state makes the write
 * idempotent: replaying it is a no-op, not an inversion.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

type Supabase = SupabaseClient<Database>

export interface ServiceResult {
  status: number
  body: Json
}

/** Friendly copy (pinned by the unit + stack suites — these strings are UX). */
export const LIST_NOT_FOUND_MESSAGE = 'List not found'
export const PLAYER_NOT_ON_LIST_MESSAGE = 'Player is not on this list.'
export const CANNOT_MARK_MESSAGE =
  'You can only mark players drafted on a list you can open.'

const listIdSchema = z.uuid()

/**
 * `player_id` is TEXT in `players` (external provider ids, not UUIDs), so it
 * is bounded rather than shape-checked. `drafted` is the DESIRED state, not a
 * flip — see the file header.
 */
export const setDraftedInputSchema = z.object({
  player_id: z.string().min(1).max(128),
  drafted: z.boolean(),
})

export type SetDraftedInput = z.infer<typeof setDraftedInputSchema>

function notFound(): ServiceResult {
  return { status: 404, body: { error: LIST_NOT_FOUND_MESSAGE } }
}

/**
 * Who does this client actually speak for?
 *
 * `userId` is a parameter, and RLS treats a disagreement between it and the
 * client's real `auth.uid()` asymmetrically: an INSERT is REJECTED by
 * `WITH CHECK` (42501 → a loud 403), but a SELECT or a DELETE is silently
 * FILTERED by `USING` and simply returns/removes nothing. Left alone, that
 * makes "you had no mark" and "you are not allowed to touch that mark" the same
 * answer on the read and un-mark paths while the mark path distinguishes them —
 * exactly the shape CLAUDE.md forbids ("never let 'nothing happened' mean 'it
 * worked'"; prove the REASON for emptiness). R175 (write), R176 (read).
 *
 * Called ONLY when a query came back empty, so the common path pays nothing
 * and — deliberately — the 42501 arm of `setDrafted` stays reachable through
 * the service, which is the only thing that keeps its code→copy mapping pinned.
 *
 * **`verifiedUserId` is R178, folded in at LV.1.3.** Every route handler in
 * `…/drafted/route.ts` has already resolved `auth.getUser()` one call earlier
 * and passes that same id as `userId`; re-resolving it here put a second GoTrue
 * round-trip on the *legitimate idempotent-replay path* — the path this file's
 * own header says to expect ("a checkbox with an optimistic update retries"),
 * and the path LV.1.3's hook now drives on every un-mark. When the caller
 * threads what it already proved, the comparison is done in memory and no
 * round-trip happens at all. When it does not (any caller that has not proven
 * an identity — including this suite's deliberately-mismatched drivers), the
 * `auth.getUser()` fallback is unchanged.
 *
 * **The trust boundary this does not move.** A caller could thread a
 * `verifiedUserId` it never verified and turn the 403 back into a 200
 * `changed:false`. That costs nothing real: this layer is friendly 4xxs, and
 * 079's RLS — not this function — is what actually stops the rows from moving.
 * The parameter must therefore only ever be fed from the *same client's* own
 * `auth.getUser()`, which is exactly what the route does.
 */
async function assertCallerIs(
  supabase: Supabase,
  userId: string,
  verifiedUserId?: string,
): Promise<ServiceResult | null> {
  if (verifiedUserId !== undefined) {
    return verifiedUserId === userId
      ? null
      : { status: 403, body: { error: CANNOT_MARK_MESSAGE } }
  }

  const { data, error } = await supabase.auth.getUser()
  // Never swallow this: an unprovable no-op is not a provable one.
  if (error) return { status: 500, body: { error: error.message } }
  if (!data.user) return { status: 401, body: { error: 'Unauthorized' } }
  if (data.user.id !== userId) {
    return { status: 403, body: { error: CANNOT_MARK_MESSAGE } }
  }
  return null
}

/**
 * Is this list readable by the caller, and alive? Runs under the caller's RLS,
 * so "readable" means exactly what `lists`'s policies say — the owner's own
 * lists, anyone's public list (D2's Saved-tab case), and a private list shared
 * with the caller's league under migration 067. A miss is a 404 whether the
 * list is private, trashed, or imaginary: the same answer for all three leaks
 * nothing about which.
 */
async function assertListReadable(
  supabase: Supabase,
  listId: string,
): Promise<ServiceResult | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .is('deleted_at', null)
    .maybeSingle()

  // A failed probe is NOT a missing list. Say so loudly rather than 404ing.
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return notFound()
  return null
}

/**
 * GET — the player ids the caller has marked drafted on this list.
 *
 * Returns ids only: `useDraftMode` (LV.1.3) holds a `Set<string>`, and D2
 * gives `drafted_at` no user-visible meaning.
 */
export async function listDrafted(
  supabase: Supabase,
  listId: string,
  userId: string,
  verifiedUserId?: string,
): Promise<ServiceResult> {
  if (!listIdSchema.safeParse(listId).success) return notFound()

  const listProblem = await assertListReadable(supabase, listId)
  if (listProblem) return listProblem

  const { data, error } = await supabase
    .from('list_player_drafted')
    .select('player_id')
    .eq('user_id', userId)
    .eq('list_id', listId)

  // An error here must never render as "nobody is drafted yet".
  if (error) return { status: 500, body: { error: error.message } }

  const rows = data ?? []

  // R176 — an empty read is either "you hold no marks here" or "RLS filtered
  // your SELECT because you asked on someone else's behalf". Those are not the
  // same fact, and the un-mark path eleven lines below has refused to conflate
  // them since R175. Same lazy placement, same reason: the path that actually
  // has marks pays nothing.
  if (rows.length === 0) {
    const identityProblem = await assertCallerIs(supabase, userId, verifiedUserId)
    if (identityProblem) return identityProblem
  }

  return {
    status: 200,
    body: { list_id: listId, drafted: rows.map((row) => row.player_id) },
  }
}

/**
 * POST — set one player's drafted state on this list for the caller.
 *
 * `changed` reports whether a row actually moved, so a replayed request is
 * visibly a no-op rather than an invisible one.
 */
export async function setDrafted(
  supabase: Supabase,
  listId: string,
  userId: string,
  rawBody: unknown,
  verifiedUserId?: string,
): Promise<ServiceResult> {
  if (!listIdSchema.safeParse(listId).success) return notFound()

  const parsed = setDraftedInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { player_id, drafted } = parsed.data

  const listProblem = await assertListReadable(supabase, listId)
  if (listProblem) return listProblem

  // The player must actually be on this list. 079's composite FK guarantees
  // this at the DB, but a bare 23503 is not UX — probe first so the answer
  // names the reason. (The FK still wins the race below.)
  const { data: onList, error: onListError } = await supabase
    .from('list_players')
    .select('player_id')
    .eq('list_id', listId)
    .eq('player_id', player_id)
    .maybeSingle()
  if (onListError) return { status: 500, body: { error: onListError.message } }
  if (!onList) {
    return { status: 404, body: { error: PLAYER_NOT_ON_LIST_MESSAGE } }
  }

  if (drafted) {
    const { error } = await supabase
      .from('list_player_drafted')
      .insert({ user_id: userId, list_id: listId, player_id })

    if (error) {
      // Already marked — the requested state, reached earlier. Idempotent.
      if (error.code === '23505') {
        return { status: 200, body: { list_id: listId, player_id, drafted: true, changed: false } }
      }
      // RLS refused the write (private list the caller cannot read, spoofed
      // user_id). 079's WITH CHECK is the gate; this is its friendly face.
      if (error.code === '42501') {
        return { status: 403, body: { error: CANNOT_MARK_MESSAGE } }
      }
      // The player left the list between the probe and the insert.
      if (error.code === '23503') {
        return { status: 404, body: { error: PLAYER_NOT_ON_LIST_MESSAGE } }
      }
      return { status: 500, body: { error: error.message } }
    }

    return { status: 200, body: { list_id: listId, player_id, drafted: true, changed: true } }
  }

  const { data: removed, error: deleteError } = await supabase
    .from('list_player_drafted')
    .delete()
    .eq('user_id', userId)
    .eq('list_id', listId)
    .eq('player_id', player_id)
    .select('player_id')

  if (deleteError) return { status: 500, body: { error: deleteError.message } }

  // Nothing moved — say WHY. Either the mark was already gone (a legitimate
  // idempotent replay) or this client cannot speak for `userId` at all, in
  // which case RLS filtered the DELETE away silently. See assertCallerIs.
  if ((removed ?? []).length === 0) {
    const identityProblem = await assertCallerIs(supabase, userId, verifiedUserId)
    if (identityProblem) return identityProblem
  }

  return {
    status: 200,
    body: {
      list_id: listId,
      player_id,
      drafted: false,
      changed: (removed ?? []).length > 0,
    },
  }
}

/**
 * DELETE — clear every drafted mark the caller holds on this list. Surfaced by
 * LV.3.9's "Clear drafted" option, and D2's answer to reusing a list next
 * season.
 *
 * Deliberately does NOT require the list to be readable, unlike GET and POST:
 * 079's DELETE policy is unconditional on purpose so a user can always clean
 * up their own rows, including on a list that has since gone private or into
 * the owner's trash. `cleared` is the honest row count, so 0 means "you had no
 * marks here" — a fact, not an inference, which is why a 0 is made to prove
 * itself against the caller's real identity below (R175).
 */
export async function clearDrafted(
  supabase: Supabase,
  listId: string,
  userId: string,
  verifiedUserId?: string,
): Promise<ServiceResult> {
  if (!listIdSchema.safeParse(listId).success) return notFound()

  const { data, error } = await supabase
    .from('list_player_drafted')
    .delete()
    .eq('user_id', userId)
    .eq('list_id', listId)
    .select('player_id')

  if (error) return { status: 500, body: { error: error.message } }

  // `cleared: 0` must mean "there was nothing to clear", never "RLS filtered
  // your DELETE because you asked on someone else's behalf".
  if ((data ?? []).length === 0) {
    const identityProblem = await assertCallerIs(supabase, userId, verifiedUserId)
    if (identityProblem) return identityProblem
  }

  return { status: 200, body: { list_id: listId, cleared: (data ?? []).length } }
}
