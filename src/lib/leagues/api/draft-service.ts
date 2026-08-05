/**
 * Draft schedule/start API service layer — M2 task L.B2.1 (spec §15.2;
 * tasks-M2 D92/D94/D95/D101; D105's RPC surface).
 *
 * Same layering as leagues-service (L.A1.12 precedent): the Route Handlers
 * under `src/app/api/leagues/[id]/draft/` are thin wrappers (auth + param
 * plumbing) and everything testable lives here over an INJECTED Supabase
 * client, so the stack suite (`draft-api-db.test.ts`) drives the identical
 * composition over the real PostgREST wire path with real signed-in users.
 *
 * Surface (§15.2):
 *   - POST  …/draft        → `draft_create`  (commish; idempotent vs the D95
 *     partial unique — a replayed create answers 200 with the existing row,
 *     the D68 replayed-success convention).
 *   - PATCH …/draft        → pre-start order edit incl. randomize →
 *     `draft_set_order` (069; D101/D108(7): "L.B2.1's pre-start PATCH stays
 *     the ordinary surface"). **No schedule field** — every
 *     `draft_scheduled_at` change flows through the league-settings PATCH
 *     (D95's single pre-start store; the strict body schema makes a smuggled
 *     schedule key a 400). Post-start (live/paused) order edits are L.B2.3's
 *     dispatch (reason required per D97) — until it lands they refuse with a
 *     seam 409, the 059 "lands in M2" refusal precedent.
 *   - POST  …/draft/start  → `draft_start`   (commish; create-if-absent +
 *     idempotent re-start are the RPC's — D105(3)).
 *
 * L.B2.2 extends this file with the room's own surface (§15.2/§15.5;
 * D92 "every mutation is a route"):
 *   - POST …/draft/pick      → `draft_make_pick` (action_id REQUIRED —
 *     minted per submit by the hook, the D68(1) stamping pattern; E1's
 *     race loser gets the RPC's friendly message verbatim as a 400, E2's
 *     replay returns the original pick as a 200).
 *   - POST …/draft/queue     → whole-queue upsert/reorder as the caller's
 *     OWN rows over the 065 client-write policy (`draft_queues` is the one
 *     spec-sanctioned client-writable draft table, §12.6) — the service
 *     resolves the caller's seat itself and RLS backstops it.
 *   - POST …/draft/queue/from-list/[listId] → §8.9 "load into queue": the
 *     attached list in `list_players.position` order (068's autopick order
 *     mirrored), already-drafted players SKIPPED, replace|append.
 *   - POST …/draft/autodraft → the SELF half of `set_team_autodraft`
 *     (072/F33); the commissioner half rides the members PATCH
 *     (members-service.ts).
 *
 * Randomize entropy (D101 instant shuffle): the ESLint determinism guard
 * bans every random source under `src/lib/leagues/**` (L.A0.3/R22), so the
 * shuffle here is PURE over injected uniform values — the ROUTE (outside the
 * guard) supplies crypto entropy per click; tests supply literals and pin
 * the exact permutation. The RPC validates the permutation either way and
 * remains the only writer (server-authoritative, §8.1).
 *
 * SQLSTATE mapping carries the 062/063 convention: 42501 → 403 (no-leak:
 * nonexistent league answers the same), P0002 → 404, P0001 → 400 friendly,
 * 22023 → 400.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Draft, Json } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

const NOT_COMMISH_MESSAGE = 'Only the commissioner can manage the draft.'
const NO_ACTIVE_DRAFT_MESSAGE =
  'No draft is scheduled for this league yet — create one from Draft setup first.'
const POST_START_ORDER_MESSAGE =
  'The draft has already started — mid-draft order changes arrive with the commissioner draft controls in M2.'

/** Statuses that make a non-mock draft "active" (the D95 partial-unique set). */
export const ACTIVE_DRAFT_STATUSES = ['scheduled', 'live', 'paused'] as const

export interface DraftStateBody {
  draft: Draft
  created?: boolean
  started?: boolean
}

function mapDraftRpcError(
  error: { code?: string; message: string },
  forbiddenMessage: string = NOT_COMMISH_MESSAGE,
): ServiceResult {
  if (error.code === '42501') {
    // Non-commish AND nonexistent league both land here (the RPCs' no-leak
    // fast-fail) — surface as 403, the deleteLeague precedent.
    return { status: 403, body: { error: forbiddenMessage } }
  }
  if (error.code === 'P0002') {
    return { status: 404, body: { error: 'League not found' } }
  }
  if (error.code === 'P0001' || error.code === '22023') {
    // Friendly in-body refusals are UX (§8.3 checklist) — surfaced verbatim.
    return { status: 400, body: { error: error.message } }
  }
  return { status: 500, body: { error: error.message } }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft — create/schedule (D95 hydration in the RPC)
// ---------------------------------------------------------------------------

export async function createDraft(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('draft_create', { p_league_id: leagueId })
  if (error) return mapDraftRpcError(error)
  const result = data as unknown as DraftStateBody
  // Idempotent double-create (D95): the existing row back as a 200 — a
  // success, never a conflict (the D68 replayed-submit convention).
  return { status: result.created ? 201 : 200, body: result as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH /api/leagues/[id]/draft — pre-start order edit (explicit | randomize)
// ---------------------------------------------------------------------------

/**
 * PATCH body: exactly one of `order` (the manual drag result — a full
 * permutation of active franchise ids) or `randomize: true` (D101's instant
 * shuffle). `reason` is accepted for forward-compat with L.B2.3's post-start
 * dispatch (D97) and stored nowhere (the F32 pattern). strictObject is the
 * D95 fence: `draft_scheduled_at` (or any other key) in this body is a 400 —
 * the league-settings PATCH is the only schedule writer.
 */
export const patchDraftInputSchema = z
  .strictObject({
    order: z.array(z.uuid()).min(1).optional(),
    randomize: z.literal(true).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((body) => (body.order !== undefined) !== (body.randomize !== undefined), {
    message: 'Send exactly one of `order` (the full team order) or `randomize: true`.',
  })
export type PatchDraftInput = z.infer<typeof patchDraftInputSchema>

/**
 * Pure Fisher–Yates over INJECTED uniform values in [0, 1) — one value per
 * swap step, consumed front-to-back (`values[0]` drives the last index).
 * Deterministic given (ids, values), which is what makes the wire pin
 * possible; the route supplies crypto entropy, never this module.
 */
export function shuffleTeamIds(ids: readonly string[], values: readonly number[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const r = values[out.length - 1 - i] ?? 0
    const j = Math.min(i, Math.max(0, Math.floor(r * (i + 1))))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface PatchDraftOrderDeps {
  /** `count` uniform values in [0, 1) for the randomize shuffle. */
  randomValues: (count: number) => number[]
}

export async function patchDraftOrder(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
  deps: PatchDraftOrderDeps,
): Promise<ServiceResult> {
  const parsed = patchDraftInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  // Locate the active non-mock draft over RLS (member SELECT, 065): a
  // non-member sees no row — 404, indistinguishable from no draft (no-leak);
  // the D95 partial unique guarantees at most one row matches.
  const { data: draft, error: draftError } = await supabase
    .from('drafts')
    .select('id, status')
    .eq('league_id', leagueId)
    .eq('is_mock', false)
    .in('status', [...ACTIVE_DRAFT_STATUSES])
    .maybeSingle()
  if (draftError) {
    return { status: 500, body: { error: draftError.message } }
  }
  if (!draft) {
    return { status: 404, body: { error: NO_ACTIVE_DRAFT_MESSAGE } }
  }
  if (draft.status !== 'scheduled') {
    // The L.B2.3 seam (tasks-M2 §6: "post-start order edits route through
    // L.B2.3's dispatch") — an explicit refusal, the 059 precedent.
    return { status: 409, body: { error: POST_START_ORDER_MESSAGE } }
  }

  let order: string[]
  if (parsed.data.randomize) {
    // Active franchises, id-sorted so (entropy → permutation) is a pure
    // function of the fetched set (the wire pin's determinism).
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .neq('status', 'retired')
      .order('id', { ascending: true })
    if (teamsError) {
      return { status: 500, body: { error: teamsError.message } }
    }
    const ids = (teams ?? []).map((t) => t.id)
    if (ids.length === 0) {
      // R156: this state is corruption-only — an active scheduled draft was
      // FOUND above (member-visible), and every league carries at least the
      // commissioner's active franchise (create_league seats one; retire is
      // draft-gated). Answering the no-draft 404 here would misdirect; it is
      // an invariant breach, surfaced as a 500.
      return {
        status: 500,
        body: { error: 'Draft order randomize found no active franchises for this league.' },
      }
    }
    order = shuffleTeamIds(ids, deps.randomValues(ids.length))
  } else {
    order = parsed.data.order as string[]
  }

  // draft_set_order (069) is the writer + validator (permutation of active
  // franchises → friendly P0001) and posts the D97 system chat message.
  const { data, error } = await supabase.rpc('draft_set_order', {
    p_draft_id: draft.id,
    p_order: order,
    ...(parsed.data.reason !== undefined ? { p_reason: parsed.data.reason } : {}),
  })
  if (error) return mapDraftRpcError(error)
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/start — manual start (D94's early path)
// ---------------------------------------------------------------------------

export async function startDraft(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('draft_start', { p_league_id: leagueId })
  if (error) return mapDraftRpcError(error)
  // Both started:true and the D63-class idempotent re-start (started:false)
  // are 200 successes — the RPC's contract (D105(3)).
  return { status: 200, body: data as unknown as Json }
}

// ===========================================================================
// L.B2.2 — the room surface: pick / queue / from-list / autodraft
// ===========================================================================

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of this league.'
export const NOT_YOUR_MOCK_MESSAGE =
  "This mock draft is another member's solo practice (§8.8)."
export const LIST_NOT_ATTACHED_MESSAGE = 'That list is not attached to this league.'
export const NO_SEAT_MESSAGE = 'You do not manage a franchise in this league.'
export const AUTODRAFT_FORBIDDEN_MESSAGE =
  "Only that seat's manager or a commissioner can toggle autodraft."

type DraftActionRow = {
  id: string
  status: string
  is_mock: boolean
  config: Json
}

/**
 * Resolve the draft an action targets. `draft_id` is optional: absent, the
 * active NON-mock draft is probed (the patchDraftOrder probe — a mock room
 * always knows and sends its id); present, the row is fetched under the same
 * member-scoped RLS. Either way a non-member answers the SAME 404 as
 * no-draft (no-leak — the R155 class).
 */
async function resolveDraftForAction(
  supabase: Supabase,
  leagueId: string,
  draftId: string | undefined,
): Promise<{ draft: DraftActionRow } | { failure: ServiceResult }> {
  const base = supabase
    .from('drafts')
    .select('id, status, is_mock, config')
    .eq('league_id', leagueId)
  const { data, error } = draftId
    ? await base.eq('id', draftId).maybeSingle()
    : await base
        .eq('is_mock', false)
        .in('status', [...ACTIVE_DRAFT_STATUSES])
        .maybeSingle()
  if (error) {
    return { failure: { status: 500, body: { error: error.message } } }
  }
  if (!data) {
    return { failure: { status: 404, body: { error: NO_ACTIVE_DRAFT_MESSAGE } } }
  }
  return { draft: data as DraftActionRow }
}

/**
 * Whose queue does the caller write? Real draft → the caller's own seat
 * (§12.6 "a manager sees/edits only their own queue" — the 065 policy is the
 * RLS backstop). Mock draft → the LAUNCHER writes the HUMAN seat's queue and
 * nobody else touches it (D103(3), the 065 carve-out mirrored; the seat's
 * chosen franchise may not be the caller's own).
 */
async function resolveQueueTeam(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  draft: DraftActionRow,
): Promise<{ teamId: string } | { failure: ServiceResult }> {
  if (draft.is_mock) {
    const mock = (draft.config as { mock?: { launched_by?: string; human_team_id?: string } })
      ?.mock
    if (mock?.launched_by !== userId || !mock.human_team_id) {
      return { failure: { status: 403, body: { error: NOT_YOUR_MOCK_MESSAGE } } }
    }
    return { teamId: mock.human_team_id }
  }
  const { data: seat, error } = await supabase
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    return { failure: { status: 500, body: { error: error.message } } }
  }
  if (!seat?.team_id) {
    return { failure: { status: 404, body: { error: NO_SEAT_MESSAGE } } }
  }
  return { teamId: seat.team_id }
}

interface QueueRow {
  player_id: string
  rank: number
}

/** Read back the (draft, team) queue in rank order — the response truth. */
async function readQueue(
  supabase: Supabase,
  draftId: string,
  teamId: string,
): Promise<QueueRow[]> {
  const { data, error } = await supabase
    .from('draft_queues')
    .select('player_id, rank')
    .eq('draft_id', draftId)
    .eq('team_id', teamId)
    .order('rank', { ascending: true })
  if (error) throw new Error(`queue read failed: ${error.message}`)
  return (data ?? []) as QueueRow[]
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/pick — make a pick (§15.2 → draft_make_pick)
// ---------------------------------------------------------------------------

/** `action_id` is REQUIRED wire-side (E2): the hook mints one UUID per user
 *  submit (D68(1)) so a React Query retry replays instead of double-picking. */
export const makePickInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  player_id: z.string().trim().min(1),
  action_id: z.uuid(),
})

export async function makePick(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = makePickInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, leagueId, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure

  // The RPC is the authority (turn, availability/E1, replay/E2, mock seam —
  // all under the §4.6 drafts-row lock); this layer only maps SQLSTATEs.
  const { data, error } = await supabase.rpc('draft_make_pick', {
    p_draft_id: resolved.draft.id,
    p_player_id: parsed.data.player_id,
    p_action_id: parsed.data.action_id,
  })
  if (error) return mapDraftRpcError(error, NOT_A_MEMBER_MESSAGE)
  // Fresh pick and the E2 replay are BOTH 200 successes (the replayed-submit
  // convention — the client cannot tell a retried submit from its original).
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/queue — whole-queue upsert / reorder (§8.4)
// ---------------------------------------------------------------------------

/** The body IS the queue: the full ordered player list (replace semantics —
 *  a reorder posts the same set in its new order; [] clears). 500 is a shape
 *  ceiling, not product law — no draft needs a deeper queue than the pool. */
export const upsertQueueInputSchema = z
  .strictObject({
    draft_id: z.uuid().optional(),
    players: z.array(z.string().trim().min(1)).max(500),
  })
  .refine((body) => new Set(body.players).size === body.players.length, {
    message: 'A player can appear in the queue only once.',
    path: ['players'],
  })

export async function upsertQueue(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = upsertQueueInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, leagueId, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure
  const seat = await resolveQueueTeam(supabase, leagueId, userId, resolved.draft)
  if ('failure' in seat) return seat.failure

  // Validate every player id BEFORE the destructive replace: PostgREST gives
  // no cross-request transaction, so a delete-then-failed-insert would leave
  // the queue emptied. Queue rows are advisory hints (drafted players are
  // legal — autopick skips them, §8.4), but unknown ids are a 400.
  if (parsed.data.players.length > 0) {
    const { data: known, error: knownError } = await supabase
      .from('players')
      .select('id')
      .in('id', parsed.data.players)
    if (knownError) {
      return { status: 500, body: { error: knownError.message } }
    }
    const knownIds = new Set((known ?? []).map((p) => p.id))
    const missing = parsed.data.players.filter((id) => !knownIds.has(id))
    if (missing.length > 0) {
      return {
        status: 400,
        body: { error: `Unknown player id(s): ${missing.join(', ')}` },
      }
    }
  }

  // Replace: clear own rows, insert the new order rank 1..n. Both statements
  // run under the caller's JWT — the 065 "Own queue write" policy is the
  // backstop (a row for a seat the caller does not own never lands).
  const { error: clearError } = await supabase
    .from('draft_queues')
    .delete()
    .eq('draft_id', resolved.draft.id)
    .eq('team_id', seat.teamId)
  if (clearError) {
    return { status: 500, body: { error: clearError.message } }
  }
  if (parsed.data.players.length > 0) {
    const { error: insertError } = await supabase.from('draft_queues').insert(
      parsed.data.players.map((playerId, index) => ({
        draft_id: resolved.draft.id,
        team_id: seat.teamId,
        player_id: playerId,
        rank: index + 1,
      })),
    )
    if (insertError) {
      // 42501/RLS should be unreachable (the seat was resolved above) — any
      // insert failure after the clear is surfaced loudly, never swallowed.
      return { status: 500, body: { error: insertError.message } }
    }
  }

  const queue = await readQueue(supabase, resolved.draft.id, seat.teamId)
  return {
    status: 200,
    body: {
      draft_id: resolved.draft.id,
      team_id: seat.teamId,
      queue,
    } as unknown as Json,
  }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/queue/from-list/[listId] — §8.9 load-into-queue
// ---------------------------------------------------------------------------

export const queueFromListInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  /** §8.9: "load … in list order" (replace, the default) or "Add remaining"
   *  (append after the current queue tail). */
  mode: z.enum(['replace', 'append']).default('replace'),
})

export async function queueFromList(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  listId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!z.uuid().safeParse(listId).success) {
    return { status: 404, body: { error: LIST_NOT_ATTACHED_MESSAGE } }
  }
  const parsed = queueFromListInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, leagueId, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure
  const seat = await resolveQueueTeam(supabase, leagueId, userId, resolved.draft)
  if ('failure' in seat) return seat.failure

  // The list must be ATTACHED to this league and visible to the caller (own
  // attachment or a league-shared one — the 067 RLS scope). Invisible ≡ not
  // attached (no-leak 404).
  const { data: attachment, error: attachError } = await supabase
    .from('league_lists')
    .select('id, list_id')
    .eq('league_id', leagueId)
    .eq('list_id', listId)
    .maybeSingle()
  if (attachError) {
    return { status: 500, body: { error: attachError.message } }
  }
  if (!attachment) {
    return { status: 404, body: { error: LIST_NOT_ATTACHED_MESSAGE } }
  }

  // List order = `list_players.position, player_id` — EXACTLY the order the
  // 068 autopick reads a board in (one ordering, two consumers).
  const { data: listRows, error: listError } = await supabase
    .from('list_players')
    .select('player_id')
    .eq('list_id', listId)
    .order('position', { ascending: true })
    .order('player_id', { ascending: true })
  if (listError) {
    return { status: 500, body: { error: listError.message } }
  }
  const listOrder = (listRows ?? []).map((row) => row.player_id)

  // §8.9 "skipping already-drafted players": LIVE picks only — an undone
  // pick's player is back in the pool and stays loadable (§12.4/E4).
  const { data: picks, error: picksError } = await supabase
    .from('draft_picks')
    .select('player_id')
    .eq('draft_id', resolved.draft.id)
    .eq('is_undone', false)
  if (picksError) {
    return { status: 500, body: { error: picksError.message } }
  }
  const drafted = new Set((picks ?? []).map((row) => row.player_id))

  const existing = await readQueue(supabase, resolved.draft.id, seat.teamId)
  const alreadyQueued = new Set(existing.map((row) => row.player_id))

  let skippedDrafted = 0
  let skippedQueued = 0
  const toInsert: string[] = []
  for (const playerId of listOrder) {
    if (drafted.has(playerId)) {
      skippedDrafted += 1
      continue
    }
    // Replace rebuilds from scratch, so only append skips queued players.
    if (parsed.data.mode === 'append' && alreadyQueued.has(playerId)) {
      skippedQueued += 1
      continue
    }
    toInsert.push(playerId)
  }

  if (parsed.data.mode === 'replace') {
    const { error: clearError } = await supabase
      .from('draft_queues')
      .delete()
      .eq('draft_id', resolved.draft.id)
      .eq('team_id', seat.teamId)
    if (clearError) {
      return { status: 500, body: { error: clearError.message } }
    }
  }
  const startRank =
    parsed.data.mode === 'append' ? Math.max(0, ...existing.map((row) => row.rank)) : 0
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('draft_queues').insert(
      toInsert.map((playerId, index) => ({
        draft_id: resolved.draft.id,
        team_id: seat.teamId,
        player_id: playerId,
        rank: startRank + index + 1,
      })),
    )
    if (insertError) {
      return { status: 500, body: { error: insertError.message } }
    }
  }

  const queue = await readQueue(supabase, resolved.draft.id, seat.teamId)
  return {
    status: 200,
    body: {
      draft_id: resolved.draft.id,
      team_id: seat.teamId,
      mode: parsed.data.mode,
      added: toInsert.length,
      skipped_drafted: skippedDrafted,
      skipped_queued: skippedQueued,
      queue,
    } as unknown as Json,
  }
}

// ---------------------------------------------------------------------------
// POST /api/leagues/[id]/draft/autodraft — the SELF toggle (§8.4 → 072 RPC)
// ---------------------------------------------------------------------------

export const setAutodraftInputSchema = z.strictObject({
  on: z.boolean(),
})

/**
 * "Auto-draft me" (§8.4): the caller toggles their OWN seat. The service
 * resolves that seat and calls `set_team_autodraft` (072 — F33's RPC half);
 * the RPC decides authorization, the D63 no-op (changed:false — a
 * double-submitted toggle is idempotent by value, the R153 recorded
 * latitude in place of an action_id arm), and the D97 system post
 * (commissioner path only — never this self path). The COMMISSIONER
 * any-team toggle rides `PATCH …/members/[mid]` (members-service.ts).
 */
export async function setAutodraft(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = setAutodraftInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  // The caller's own seat (league_members is member-SELECTable; a
  // non-member reads nothing → the same 403 the RPC's 42501 maps to).
  const { data: seat, error: seatError } = await supabase
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()
  if (seatError) {
    return { status: 500, body: { error: seatError.message } }
  }
  if (!seat?.team_id) {
    return { status: 403, body: { error: NOT_A_MEMBER_MESSAGE } }
  }

  const { data, error } = await supabase.rpc('set_team_autodraft', {
    p_league_id: leagueId,
    p_team_id: seat.team_id,
    p_on: parsed.data.on,
  })
  if (error) return mapDraftRpcError(error, AUTODRAFT_FORBIDDEN_MESSAGE)
  return { status: 200, body: data as unknown as Json }
}
