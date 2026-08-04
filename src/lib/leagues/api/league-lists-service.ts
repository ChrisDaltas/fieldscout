/**
 * League-lists service layer — M2 task L.B4.1 (spec §7.4, §12.15, §15.5;
 * PROGRESS D32/D106). The list ↔ league tie-in: attach one of my ranking
 * lists to a league, list mine + league-shared, set primary board / toggle
 * shared, detach.
 *
 * Same D68/D71 layering as `leagues-service.ts` / `members-service.ts`
 * (extend the pattern, never fork): the Route Handlers under
 * `src/app/api/leagues/[id]/lists` are thin wrappers; everything testable
 * lives here over an INJECTED Supabase client so the stack suite
 * (`league-lists-api-db.test.ts`) drives the production composition across
 * the real PostgREST wire.
 *
 * UNLIKE the RPC-backed services, every write here is DIRECT table DML:
 * `league_lists` is a spec-sanctioned client-writable table (§12.15 prints
 * the owner-scoped FOR ALL; plan §8.2's "unless the spec names it"
 * allowance), so there is no RPC to call — migration 067's RLS + the D106
 * composite FK are the ENFORCEMENT backstop and this layer's job is
 * friendly 4xxs, not authorization (the task's routed rule: friendly 4xxs,
 * never silent RLS empty-writes). Where each check lives (D106):
 *   - caller is a league member  → route probe (friendly 404, no-leak: the
 *     same answer a nonexistent league gets) BACKSTOPPED by the FOR ALL
 *     WITH CHECK's `is_league_member` (42501 on a direct write).
 *   - list belongs to the caller → route probe (friendly 403/404)
 *     BACKSTOPPED by the 067 composite FK (list_id, owner_id) →
 *     lists(id, owner_id) — 23503 on any path, closing the forced-share
 *     privacy hole at the DB.
 *   - one primary per member     → the route CLEARS the caller's current
 *     primary first (switching is one tap, §7.4), but the partial unique
 *     `uniq_primary_board_per_member` remains the guarantee — a lost race
 *     surfaces as a friendly 409, never two primaries.
 *   - retry safety (DoD idempotency) → attach probes the natural key
 *     (league_id, list_id, owner_id) BEFORE any side effect and 409s
 *     pre-demote (R127 — the same probe-before-side-effect ordering as
 *     PATCH); the UNIQUE natural key remains the race backstop: a replayed
 *     attach is a friendly 409, never a duplicate row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json, LeagueList, List } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

const uuid = z.uuid()

/** The list metadata the GET embeds beside each attachment (enough for the
 *  attach panel + My Lists panel; L.B4.2 extends the UI, not this shape).
 *  The embed is FK-HINTED: league_lists carries TWO relationships to lists
 *  (the printed list_id FK + the D106 composite ownership FK), so a bare
 *  `lists(...)` is PGRST201-ambiguous. The response key stays `lists`. */
export const LEAGUE_LIST_EMBED =
  'id, league_id, list_id, owner_id, is_primary_board, shared_with_league, created_at, ' +
  'lists!league_lists_list_id_fkey (id, owner_id, title, description, position_filter, player_count, is_private, is_big_board, updated_at)'

export type LeagueListWithList = LeagueList & {
  lists: Pick<
    List,
    | 'id'
    | 'owner_id'
    | 'title'
    | 'description'
    | 'position_filter'
    | 'player_count'
    | 'is_private'
    | 'is_big_board'
    | 'updated_at'
  > | null
}

/** Friendly copy for the two 23505s + the D106 FK (pinned by the stack suite). */
export const ALREADY_ATTACHED_MESSAGE = 'This list is already attached to this league.'
export const PRIMARY_RACE_MESSAGE =
  'Another update just changed your primary board — try again.'
export const NOT_YOUR_LIST_MESSAGE = 'You can only attach a list you own.'

function mapWriteError(error: { code?: string; message: string }): ServiceResult {
  if (error.code === '23505') {
    if (error.message.includes('uniq_primary_board_per_member')) {
      return { status: 409, body: { error: PRIMARY_RACE_MESSAGE } }
    }
    return { status: 409, body: { error: ALREADY_ATTACHED_MESSAGE } }
  }
  if (error.code === '23503') {
    // The D106 composite FK — reachable only by a race (list deleted or
    // ownership probe bypassed); the route probes make this the backstop.
    // 403 to match the probe path's semantic for the same condition (R128).
    return { status: 403, body: { error: NOT_YOUR_LIST_MESSAGE } }
  }
  if (error.code === '42501') {
    return { status: 403, body: { error: 'Only league members can manage league lists.' } }
  }
  return { status: 500, body: { error: error.message } }
}

/** No-leak membership probe: `league_members` is member-SELECTable only, so
 *  a non-member (and a nonexistent/soft-deleted league) both read zero rows
 *  → the same 404 a malformed id gets at the route. */
async function isMemberOf(
  supabase: Supabase,
  leagueId: string,
  userId: string,
): Promise<boolean | ServiceResult> {
  const { data, error } = await supabase
    .from('league_members')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  return data !== null
}

// ---------------------------------------------------------------------------
// GET /api/leagues/[id]/lists — my attached lists (+ league-shared)
// ---------------------------------------------------------------------------

/**
 * §15.5 GET. The RLS SELECT policy already scopes rows to exactly "mine OR
 * shared-with-a-league-I'm-in", so the query is a plain league filter; the
 * embedded list is readable for shared-private lists via 067's additive
 * `lists` policy. An embed can still be null (e.g. the shared attachment of
 * a list its owner has since soft-deleted — the attachment row stays
 * member-visible, the list does not); rows with a null embed are kept so
 * the owner's own panel can surface the dangling attachment for detach.
 */
export async function listLeagueLists(
  supabase: Supabase,
  leagueId: string,
  userId: string,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success) {
    return { status: 404, body: { error: 'League not found' } }
  }
  const membership = await isMemberOf(supabase, leagueId, userId)
  if (typeof membership !== 'boolean') return membership
  if (!membership) {
    return { status: 404, body: { error: 'League not found' } }
  }

  const { data, error } = await supabase
    .from('league_lists')
    .select(LEAGUE_LIST_EMBED)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: true })
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  return { status: 200, body: { league_lists: data } as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/lists — attach one of my lists
// ---------------------------------------------------------------------------

export const attachListInputSchema = z.strictObject({
  list_id: z.uuid(),
  is_primary_board: z.boolean().optional(),
  shared_with_league: z.boolean().optional(),
})

/** Clear the caller's current primary in this league (the one-tap primary
 *  switch, §7.4) — RLS scopes the UPDATE to their own rows anyway; the
 *  explicit owner filter is documentation. The `except*` exclusions keep
 *  replays retry-safe (DoD idempotency): a RETRIED attach/PATCH must not
 *  demote the very primary its original call set. */
async function clearCurrentPrimary(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  except: { id?: string; listId?: string },
): Promise<ServiceResult | null> {
  let query = supabase
    .from('league_lists')
    .update({ is_primary_board: false })
    .eq('league_id', leagueId)
    .eq('owner_id', userId)
    .eq('is_primary_board', true)
  if (except.id) {
    query = query.neq('id', except.id)
  }
  if (except.listId) {
    query = query.neq('list_id', except.listId)
  }
  const { error } = await query
  if (error) {
    return mapWriteError(error)
  }
  return null
}

export async function attachLeagueList(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success) {
    return { status: 404, body: { error: 'League not found' } }
  }
  const parsed = attachListInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const membership = await isMemberOf(supabase, leagueId, userId)
  if (typeof membership !== 'boolean') return membership
  if (!membership) {
    return { status: 404, body: { error: 'League not found' } }
  }

  // Friendly ownership probe (the D106 FK is the backstop): an invisible
  // list (someone else's private, or nonexistent) reads null → 404 with no
  // existence leak; a VISIBLE list someone else owns (public) → 403.
  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id, owner_id, deleted_at')
    .eq('id', parsed.data.list_id)
    .maybeSingle()
  if (listError) {
    return { status: 500, body: { error: listError.message } }
  }
  if (!list || list.deleted_at !== null) {
    return { status: 404, body: { error: 'List not found' } }
  }
  if (list.owner_id !== userId) {
    return { status: 403, body: { error: NOT_YOUR_LIST_MESSAGE } }
  }

  // Probe the natural key BEFORE the clear-first side effect (R127): an
  // attach of an ALREADY-attached list — byte-identical replay OR the
  // neighboring attach-as-primary of a list originally attached non-primary
  // — must 409 with ZERO side effects. Without this ordering the clear-first
  // demote ran, the INSERT hit the natural-key 23505, and the caller was
  // left with no primary under an error response (the same class the PATCH
  // path's probe-before-side-effect ordering prevents). The 23505 at the
  // INSERT remains the race backstop.
  const { data: existing, error: existingError } = await supabase
    .from('league_lists')
    .select('id')
    .eq('league_id', leagueId)
    .eq('list_id', parsed.data.list_id)
    .eq('owner_id', userId)
    .maybeSingle()
  if (existingError) {
    return { status: 500, body: { error: existingError.message } }
  }
  if (existing) {
    return { status: 409, body: { error: ALREADY_ATTACHED_MESSAGE } }
  }

  if (parsed.data.is_primary_board === true) {
    // The `except.listId` exclusion is now a RACE backstop only (the probe
    // above already 409s any visible pre-existing attachment): a concurrent
    // duplicate attach that lands between the probe and this clear must not
    // demote the primary its twin just set.
    const cleared = await clearCurrentPrimary(supabase, leagueId, userId, {
      listId: parsed.data.list_id,
    })
    if (cleared) return cleared
  }

  const { data, error } = await supabase
    .from('league_lists')
    .insert({
      league_id: leagueId,
      list_id: parsed.data.list_id,
      owner_id: userId,
      is_primary_board: parsed.data.is_primary_board ?? false,
      shared_with_league: parsed.data.shared_with_league ?? false,
    })
    .select(LEAGUE_LIST_EMBED)
    .single()
  if (error) {
    return mapWriteError(error)
  }
  return { status: 201, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH /api/leagues/[id]/lists/[llid] — set primary board / toggle shared
// ---------------------------------------------------------------------------

export const patchLeagueListInputSchema = z
  .strictObject({
    is_primary_board: z.boolean().optional(),
    shared_with_league: z.boolean().optional(),
  })
  .refine(
    (body) => body.is_primary_board !== undefined || body.shared_with_league !== undefined,
    { message: 'Nothing to update.' },
  )

export async function patchLeagueList(
  supabase: Supabase,
  leagueId: string,
  leagueListId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success || !uuid.safeParse(leagueListId).success) {
    return { status: 404, body: { error: 'Attachment not found' } }
  }
  const parsed = patchLeagueListInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  // Probe BEFORE the clear-first side effect: the SELECT policy also shows
  // OTHER members' shared attachments, so a caller passing someone else's
  // llid must 404 here — without this ordering, promoting a foreign/missing
  // row would still demote the caller's own primary on the way to the 404.
  const { data: target, error: targetError } = await supabase
    .from('league_lists')
    .select('id, owner_id')
    .eq('id', leagueListId)
    .eq('league_id', leagueId)
    .maybeSingle()
  if (targetError) {
    return { status: 500, body: { error: targetError.message } }
  }
  if (!target || target.owner_id !== userId) {
    // "Not yours" ≡ "not found" — no-leak, same as the RLS 0-row UPDATE.
    return { status: 404, body: { error: 'Attachment not found' } }
  }

  if (parsed.data.is_primary_board === true) {
    const cleared = await clearCurrentPrimary(supabase, leagueId, userId, { id: leagueListId })
    if (cleared) return cleared
  }

  // BOTH segments constrain the UPDATE (the R86 doubly-nested-route rule);
  // RLS additionally scopes to the caller's own rows, so "not yours" and
  // "not found" are the same no-leak 404 (0 rows updated).
  const { data, error } = await supabase
    .from('league_lists')
    .update(parsed.data)
    .eq('id', leagueListId)
    .eq('league_id', leagueId)
    .select(LEAGUE_LIST_EMBED)
    .maybeSingle()
  if (error) {
    return mapWriteError(error)
  }
  if (!data) {
    return { status: 404, body: { error: 'Attachment not found' } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// DELETE /api/leagues/[id]/lists/[llid] — detach
// ---------------------------------------------------------------------------

/** Non-destructive (§7.4): deletes only the association, never the list.
 *  A replayed detach reads 0 rows → 404 (retry-safe: nothing further to
 *  delete). */
export async function detachLeagueList(
  supabase: Supabase,
  leagueId: string,
  leagueListId: string,
): Promise<ServiceResult> {
  if (!uuid.safeParse(leagueId).success || !uuid.safeParse(leagueListId).success) {
    return { status: 404, body: { error: 'Attachment not found' } }
  }

  const { data, error } = await supabase
    .from('league_lists')
    .delete()
    .eq('id', leagueListId)
    .eq('league_id', leagueId)
    .select('id')
    .maybeSingle()
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  if (!data) {
    return { status: 404, body: { error: 'Attachment not found' } }
  }
  return { status: 200, body: { detached: true, id: data.id } }
}
