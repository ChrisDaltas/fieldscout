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
 * L.C2.2 (M3) extends the commissioner block with the AUCTION verbs
 * (§8.7's auction rows; spec §15.2 via the C40 erratum) — same
 * `dispatchControl` pipeline, `reason` REQUIRED, stored nowhere (F32/F40):
 *   - POST …/draft/reverse-bid        → `draft_reverse_won_bid` (pick_id)
 *   - POST …/draft/budget             → `draft_adjust_budget` (team_id, delta)
 *   - POST …/draft/cancel-nomination  → `draft_cancel_nomination` (D143)
 *   - POST …/draft/end                → `draft_end` (C41 end-as-is)
 *   and `reassign` / `move-player` gain the optional `price` (087's priced
 *   arms — D142), `clock` gains the three auction timers (087's timer arm).
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
export const POST_START_RANDOMIZE_MESSAGE =
  'The draft has already started — a mid-draft order change must be an explicit order (E31), not a randomize.'
export const POST_START_REASON_REQUIRED_MESSAGE =
  'Changing the order mid-draft is a commissioner override — include a reason (§8.7/D97).'

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
    // The L.B2.3 post-start dispatch (E31 — §15.2's PATCH prints no
    // pre-start restriction): an order body on a live/paused draft is the
    // §8.7 "Edit draft order" control — completed picks stand, remaining
    // picks re-derive (069's draft_set_order owns the math). Two guards:
    // randomize is refused (E31 is an explicit-order edit; shuffling the
    // remaining order mid-draft is not a printed control — D114), and
    // `reason` is REQUIRED (D97 — every route-facing control accepts one;
    // the post-start dispatch is where the task text makes it mandatory).
    if (parsed.data.randomize) {
      return { status: 400, body: { error: POST_START_RANDOMIZE_MESSAGE } }
    }
    if (parsed.data.reason === undefined) {
      return { status: 400, body: { error: POST_START_REASON_REQUIRED_MESSAGE } }
    }
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
 *
 * Recorded latitude (R159, M2 batch 10): the explicit-`draft_id` arm applies
 * NO status filter, so queue writes (upsertQueue/queueFromList) are accepted
 * against a `complete`/`cancelled` draft — advisory rows on a dead draft that
 * nothing ever reads (068's autopick only fires on a LIVE draft; the pick
 * path is RPC-status-guarded regardless). Deliberately left open rather than
 * guarded: the write is harmless and a guard would add a wire behavior with
 * no consumer. If a surface ever renders dead-draft queues, add the status
 * guard then.
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

/**
 * The atomic whole-queue replace — `draft_queue_replace` (082, the F54
 * discharge). One transaction + a per-seat advisory xact lock close BOTH
 * D113(3) faces (partial failure AND concurrent interleave); the function's
 * jsonb return is this call's own settled queue. SQLSTATE mapping follows
 * the house convention (42501 → 403 · 22023 → 400 friendly · else 500).
 */
async function replaceQueue(
  supabase: Supabase,
  draftId: string,
  teamId: string,
  players: string[],
): Promise<{ rows: QueueRow[] } | { failure: ServiceResult }> {
  const { data, error } = await supabase.rpc('draft_queue_replace', {
    p_draft_id: draftId,
    p_team_id: teamId,
    p_players: players,
  })
  if (error) {
    const mapped = mapDraftRpcError(error, 'You do not manage this queue.')
    // P0002/404 is unreachable here (the draft was resolved above) — the
    // 42501/22023/500 mapping is what this surface can actually answer.
    return { failure: mapped }
  }
  return { rows: (data ?? []) as unknown as QueueRow[] }
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

  // Replace via `draft_queue_replace` (082 — the F54 discharge): ONE
  // transaction (a failed insert can never leave the queue emptied — the
  // D113(3) partial-failure face) serialized per seat by an advisory xact
  // lock (concurrent replaces can never interleave into duplicate ranks —
  // the F54 concurrency face). SECURITY INVOKER: the statements inside run
  // under the caller's JWT and the 065 "Own queue write" policy stays the
  // backstop. The RPC returns THIS call's settled queue — the response
  // truth, not a later writer's.
  const queue = await replaceQueue(
    supabase,
    resolved.draft.id,
    seat.teamId,
    parsed.data.players,
  )
  if ('failure' in queue) return queue.failure
  return {
    status: 200,
    body: {
      draft_id: resolved.draft.id,
      team_id: seat.teamId,
      queue: queue.rows,
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

  // Both modes settle through the SAME atomic replace (082 — the F54
  // discharge): append composes the final order from the click-time read
  // (existing tail + the additions — the D118(6) compose-from-cache shape)
  // and replaces the whole queue in one serialized transaction; replace
  // sends the filtered list order as-is. Ranks are dense 1..n either way.
  const finalOrder =
    parsed.data.mode === 'append'
      ? [...existing.map((row) => row.player_id), ...toInsert]
      : toInsert
  const queue = await replaceQueue(supabase, resolved.draft.id, seat.teamId, finalOrder)
  if ('failure' in queue) return queue.failure

  return {
    status: 200,
    body: {
      draft_id: resolved.draft.id,
      team_id: seat.teamId,
      mode: parsed.data.mode,
      added: toInsert.length,
      skipped_drafted: skippedDrafted,
      skipped_queued: skippedQueued,
      // The ROWS ARRAY, never the replaceQueue wrapper — the declared
      // QueueResponse contract, same as upsertQueue (R298).
      queue: queue.rows,
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

// ===========================================================================
// L.B2.3 — commissioner control routes (§15.2 commish block; §8.7 via 069)
// + the mock surface (§15.2 mock-drafts; §8.8 via 071)
// ===========================================================================
//
// Controls: every verb is a thin dispatch to its 069 RPC — authorization
// (commissioner/co-commissioner in-body 42501, no-leak), the §4.6 lock, the
// legality checks, and the D97 in-txn system chat post ALL live in the RPC;
// this layer resolves the target draft (optional `draft_id`, active-non-mock
// default — the D113(2) convention: a mock room always sends its own id) and
// maps SQLSTATEs. `reason` is accepted + Zod-validated on every control and
// stored nowhere (the F32 pattern; F40 carries the M6 audit obligation) —
// OPTIONAL on the verbs (the RPCs default it NULL; the chat post is the
// transparency), REQUIRED only on the post-start order dispatch where the
// task text mandates it (D114).
//
// Mock affordances: NONE here (D110(1)) — on a mock, `draft_pause`/
// `draft_resume` are LAUNCHER-only (commissioners refused with the RPC's
// friendly P0001) and every other §8.7 control refuses mocks outright, so
// pause/resume double as the launcher's own mock lifecycle surface (the E59
// resume path — L.B3.5's resumable card is the consumer) simply by passing
// the mock's `draft_id`, and the other verbs need no mock branch at all.
//
// Launch idempotency (D110(11)/R149): `POST …/mock-drafts` always sends a
// `p_action_id` — the body's hook-minted UUID when present (the D68(1)
// stamping pattern, L.B3.5's launcher), else one minted by the ROUTE per
// submit (entropy injected — the determinism guard bans crypto here). The
// RPC's E2 replay arm answers a retried submit with the ORIGINAL mock
// (`created: false`) — treated as the same 2xx, never a duplicate-launch
// error. NULL is the RPC's legacy no-dedupe path; production never sends it.

export const MOCK_NOT_FOUND_MESSAGE = 'No such mock draft in this league.'

const reasonSchema = z.string().trim().min(1).max(500).optional()

/** Shared shape: every control accepts an optional target draft + reason. */
const controlBaseShape = {
  draft_id: z.uuid().optional(),
  reason: reasonSchema,
}

export const pauseDraftInputSchema = z.strictObject({
  ...controlBaseShape,
  action: z.enum(['pause', 'resume']),
})

/** `to_pick_number` is `min(0)`, NOT `min(1)` (R160): 0 is a DELIBERATE legal
 *  value on the RPC side — 069 validates `p_to_pick_number >= 0` explicitly
 *  (`draft_undo: to_pick_number must be >= 0`) and undoes every pick > v_to,
 *  so 0 is the full rewind (all picks reverted, pick 1 back on the clock).
 *  `draft_reset` is NOT the substitute: it flips the league back to
 *  `scheduled` and clears the stored instant (a different operation), so a
 *  narrower wire schema would make the RPC-legal full cascade unreachable. */
export const undoDraftInputSchema = z.strictObject({
  ...controlBaseShape,
  to_pick_number: z.number().int().min(0).optional(),
})

/** L.C2.2 (§8.7 Manual Edit Mode / D142): the auction's RE-ENTERED cost.
 *  Optional wire-side — a snake pick carries no price and the RPC refuses
 *  one (087); on an auction the RPC REQUIRES it when the pick changes hands
 *  and accepts a price-only correction (so `price` alone is a legal body).
 *  `min(0)` is the shape floor: `auction_min_bid = 0` is a legal league, and
 *  "below this league's minimum bid" is the RPC's own refusal (§7.3.8). */
const priceSchema = z.number().int().min(0).optional()

export const reassignPickInputSchema = z
  .strictObject({
    ...controlBaseShape,
    pick_id: z.uuid(),
    team_id: z.uuid().optional(),
    player_id: z.string().trim().min(1).optional(),
    price: priceSchema,
  })
  .refine(
    (body) =>
      body.team_id !== undefined || body.player_id !== undefined || body.price !== undefined,
    { message: 'Send a new team_id, a new player_id, a price, or a combination.' },
  )

/** `action_id` REQUIRED wire-side (rule 6/E2 — the same stamping contract as
 *  the pick route: the panel mints one UUID per submit, retries replay). */
export const forcePickInputSchema = z.strictObject({
  ...controlBaseShape,
  player_id: z.string().trim().min(1),
  action_id: z.uuid(),
})

export const movePlayerInputSchema = z.strictObject({
  ...controlBaseShape,
  player_id: z.string().trim().min(1),
  from_team: z.uuid(),
  to_team: z.uuid(),
  price: priceSchema,
})

export const resetDraftInputSchema = z.strictObject(controlBaseShape)

const timerSecondsSchema = z.number().int().min(0).max(86_400)

/**
 * L.C2.2 (tasks-M3 L.C2.2 item 2; §8.7's timer row / §7.3.8): the route
 * passes 087's auction timers through. `pick_timer_seconds` became OPTIONAL
 * because an auction-only edit legitimately names none of it — which clock a
 * body may name for which draft type is the RPC's ruling (an auction refuses
 * the pick clock, a snake refuses the auction timers); the route only
 * insists that SOME timer is named, the same shape check 087 makes first.
 */
export const setClockInputSchema = z
  .strictObject({
    ...controlBaseShape,
    pick_timer_seconds: timerSecondsSchema.optional(),
    extend_current: z.boolean().optional(),
    nomination_seconds: timerSecondsSchema.optional(),
    bid_seconds: timerSecondsSchema.optional(),
    anti_snipe_seconds: timerSecondsSchema.optional(),
  })
  .refine(
    (body) =>
      body.pick_timer_seconds !== undefined ||
      body.nomination_seconds !== undefined ||
      body.bid_seconds !== undefined ||
      body.anti_snipe_seconds !== undefined,
    { message: 'Name at least one timer to change.' },
  )

type ControlArgs = Record<string, unknown>

/**
 * The one control pipeline: parse → resolve the draft → dispatch to the
 * named RPC with the per-verb args. The RPC name is switched over a closed
 * union (never caller data).
 */
async function dispatchControl<S extends z.ZodType>(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
  schema: S,
  rpc: (body: z.infer<S>, draftId: string) => { fn: ControlRpcName; args: ControlArgs },
): Promise<ServiceResult> {
  const parsed = schema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const body = parsed.data as z.infer<S> & { draft_id?: string; reason?: string }
  const resolved = await resolveDraftForAction(supabase, leagueId, body.draft_id)
  if ('failure' in resolved) return resolved.failure

  const { fn, args } = rpc(parsed.data, resolved.draft.id)
  const { data, error } = await (
    supabase.rpc as unknown as (
      name: string,
      params: ControlArgs,
    ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
  )(fn, args)
  if (error) return mapDraftRpcError(error)
  return { status: 200, body: data as Json }
}

type ControlRpcName =
  | 'draft_pause'
  | 'draft_resume'
  | 'draft_undo'
  | 'draft_reassign_pick'
  | 'draft_force_pick'
  | 'draft_move_player'
  | 'draft_reset'
  | 'draft_set_clock'
  // L.C2.2 — the four auction commissioner verbs (migration 087; §8.7's
  // auction rows). Same CLOSED union, same pipeline; see the block below.
  | 'draft_reverse_won_bid'
  | 'draft_adjust_budget'
  | 'draft_cancel_nomination'
  | 'draft_end'

const withReason = (reason: string | undefined): ControlArgs =>
  reason !== undefined ? { p_reason: reason } : {}

/** POST …/draft/pause — §15.2's one route for BOTH verbs (`action` in body). */
export async function pauseOrResumeDraft(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, pauseDraftInputSchema, (body, draftId) => ({
    fn: body.action === 'pause' ? 'draft_pause' : 'draft_resume',
    args: { p_draft_id: draftId, ...withReason(body.reason) },
  }))
}

/** POST …/draft/undo — single (`to_pick_number` absent) or cascade (E4). */
export async function undoDraft(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, undoDraftInputSchema, (body, draftId) => ({
    fn: 'draft_undo',
    args: {
      p_draft_id: draftId,
      ...(body.to_pick_number !== undefined ? { p_to_pick_number: body.to_pick_number } : {}),
      ...withReason(body.reason),
    },
  }))
}

/** POST …/draft/reassign — new team and/or corrected player for one pick. */
export async function reassignPick(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(
    supabase,
    leagueId,
    rawBody,
    reassignPickInputSchema,
    (body, draftId) => ({
      fn: 'draft_reassign_pick',
      args: {
        p_draft_id: draftId,
        p_pick_id: body.pick_id,
        ...(body.team_id !== undefined ? { p_team_id: body.team_id } : {}),
        ...(body.player_id !== undefined ? { p_player_id: body.player_id } : {}),
        // L.C2.2: 087's priced arm (D142) — omitted, the RPC's NULL default.
        ...(body.price !== undefined ? { p_price: body.price } : {}),
        ...withReason(body.reason),
      },
    }),
  )
}

/** POST …/draft/force-pick — pick for the on-clock team (made_via = 'commissioner'). */
export async function forcePick(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, forcePickInputSchema, (body, draftId) => ({
    fn: 'draft_force_pick',
    args: {
      p_draft_id: draftId,
      p_player_id: body.player_id,
      p_action_id: body.action_id,
      ...withReason(body.reason),
    },
  }))
}

/** POST …/draft/move-player — move a drafted player between teams. */
export async function movePlayer(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, movePlayerInputSchema, (body, draftId) => ({
    fn: 'draft_move_player',
    args: {
      p_draft_id: draftId,
      p_player_id: body.player_id,
      p_from_team: body.from_team,
      p_to_team: body.to_team,
      // L.C2.2: 087's priced arm (D142) — omitted, the RPC's NULL default.
      ...(body.price !== undefined ? { p_price: body.price } : {}),
      ...withReason(body.reason),
    },
  }))
}

/** POST …/draft/reset — wipe to pre-draft (`drafting`/`paused` only; 069). */
export async function resetDraft(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, resetDraftInputSchema, (body, draftId) => ({
    fn: 'draft_reset',
    args: { p_draft_id: draftId, ...withReason(body.reason) },
  }))
}

/** POST …/draft/clock — the E15 clock edit (dedicated verb — D114). */
export async function setClock(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, setClockInputSchema, (body, draftId) => ({
    fn: 'draft_set_clock',
    args: {
      p_draft_id: draftId,
      ...(body.pick_timer_seconds !== undefined
        ? { p_pick_timer_seconds: body.pick_timer_seconds }
        : {}),
      ...(body.extend_current !== undefined ? { p_extend_current: body.extend_current } : {}),
      // L.C2.2: 087's auction timers (§8.7 timer row — E15 analog: subsequent
      // clocks); each omitted key is the RPC's NULL "unchanged".
      ...(body.nomination_seconds !== undefined
        ? { p_nomination_seconds: body.nomination_seconds }
        : {}),
      ...(body.bid_seconds !== undefined ? { p_bid_seconds: body.bid_seconds } : {}),
      ...(body.anti_snipe_seconds !== undefined
        ? { p_anti_snipe_seconds: body.anti_snipe_seconds }
        : {}),
      ...withReason(body.reason),
    },
  }))
}

// ===========================================================================
// L.C2.2 — the AUCTION commissioner verbs (§8.7's auction rows over 087;
// spec §15.2 as extended by the C40 erratum — tasks-M3 §9 C40, the v2.8.17
// clock-route precedent: auction controls get their own routes).
//
// Same pipeline as the seven above — `dispatchControl` over the CLOSED
// union, strict Zod, the 062/063 SQLSTATE mapping. ZERO business logic
// here: D141's pause-first gate, D138's mock refusal, E28's three arms, the
// D97 in-txn system post and C41's end-as-is all live in the RPCs; the
// route maps the refusal and passes its copy through verbatim.
//
// `reason` is REQUIRED on these four (the D114(1) carve-out: optional on
// the verbs, required exactly where the task text mandates it — the
// post-start order dispatch was the first; these are the money-moving /
// bid-voiding / terminal auction controls, and §8.7 prints "fully audited;
// cannot be silent" for End). It is Zod-validated and STORED NOWHERE —
// F32/F40 unchanged: the RPCs accept `p_reason` and the audit table is
// M6's. None of the four RPCs takes an `action_id` (087 signatures) — so
// none is minted or accepted here (no invented params).
// ===========================================================================

const reasonRequiredSchema = z.string().trim().min(1).max(500)

/** POST …/draft/reverse-bid — `draft_reverse_won_bid(draft, pick_id, reason)`. */
export const reverseWonBidInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  reason: reasonRequiredSchema,
  pick_id: z.uuid(),
})

/** POST …/draft/budget — `draft_adjust_budget(draft, team_id, delta, reason)`.
 *  `delta` is an integer dollar delta (cumulative at the RPC; 0 is the RPC's
 *  own 22023 refusal — not re-implemented here). The ±1,000,000 bound is an
 *  int4 shape fence, not a rule. */
export const adjustBudgetInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  reason: reasonRequiredSchema,
  team_id: z.uuid(),
  delta: z.number().int().min(-1_000_000).max(1_000_000),
})

/** POST …/draft/cancel-nomination — `draft_cancel_nomination(draft, reason)` (D143). */
export const cancelNominationInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  reason: reasonRequiredSchema,
})

/** POST …/draft/end — `draft_end(draft, reason)` (C41 end-as-is). The
 *  hard-confirm phrase is the UI's (L.C3.2); the route takes no phrase. */
export const endDraftInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  reason: reasonRequiredSchema,
})

/** POST …/draft/reverse-bid — Manual Edit Mode's "Reset pick" (D142(a)/D131(1)). */
export async function reverseWonBid(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(
    supabase,
    leagueId,
    rawBody,
    reverseWonBidInputSchema,
    (body, draftId) => ({
      fn: 'draft_reverse_won_bid',
      args: { p_draft_id: draftId, p_pick_id: body.pick_id, p_reason: body.reason },
    }),
  )
}

/** POST …/draft/budget — §8.7 "adjust a team's remaining budget" (E28; not pause-gated — D141). */
export async function adjustBudget(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, adjustBudgetInputSchema, (body, draftId) => ({
    fn: 'draft_adjust_budget',
    args: {
      p_draft_id: draftId,
      p_team_id: body.team_id,
      p_delta: body.delta,
      p_reason: body.reason,
    },
  }))
}

/** POST …/draft/cancel-nomination — §8.7 "Edit current nomination" = cancel-and-renominate (D143; paused only). */
export async function cancelNomination(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(
    supabase,
    leagueId,
    rawBody,
    cancelNominationInputSchema,
    (body, draftId) => ({
      fn: 'draft_cancel_nomination',
      args: { p_draft_id: draftId, p_reason: body.reason },
    }),
  )
}

/** POST …/draft/end — §8.7 "End draft", C41's end-as-is (terminal; not pause-gated). */
export async function endDraft(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, leagueId, rawBody, endDraftInputSchema, (body, draftId) => ({
    fn: 'draft_end',
    args: { p_draft_id: draftId, p_reason: body.reason },
  }))
}

// ---------------------------------------------------------------------------
// Mock drafts (§15.2/§8.8 — launch / list / delete; authorization is the
// RPCs' via `config.mock.launched_by`, never role — D110(1))
// ---------------------------------------------------------------------------

export const launchMockInputSchema = z.strictObject({
  human_team_id: z.uuid().optional(),
  cpu_speed: z.enum(['realistic', 'fast']).optional(),
  /** Hook-minted per submit when the launcher UI sends one (D68(1)); the
   *  route mints otherwise — the RPC ALWAYS receives a key (D110(11)). */
  action_id: z.uuid().optional(),
})

export interface LaunchMockDeps {
  /** One fresh UUID per submit (crypto in the route — outside the guard). */
  mintActionId: () => string
}

export async function launchMockDraft(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
  deps: LaunchMockDeps,
): Promise<ServiceResult> {
  const parsed = launchMockInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('create_mock_draft', {
    p_league_id: leagueId,
    ...(parsed.data.human_team_id !== undefined
      ? { p_human_team_id: parsed.data.human_team_id }
      : {}),
    ...(parsed.data.cpu_speed !== undefined ? { p_cpu_speed: parsed.data.cpu_speed } : {}),
    p_action_id: parsed.data.action_id ?? deps.mintActionId(),
  })
  if (error) return mapDraftRpcError(error, NOT_A_MEMBER_MESSAGE)
  const result = data as unknown as DraftStateBody
  // created:false = the E2 replay of a retried submit — the ORIGINAL mock as
  // a 200, never a duplicate-launch error (D110(11)).
  return { status: result.created ? 201 : 200, body: result as unknown as Json }
}

/** The §16.5.2 list surface: my active mocks (live|paused — the resumable
 *  cards, E59) + my recaps (complete — kept until owner-deleted, §8.8).
 *  RLS-scoped member SELECT; launcher-filtered server-side. */
export async function listMockDrafts(
  supabase: Supabase,
  leagueId: string,
  userId: string,
): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('drafts')
    .select(
      'id, status, draft_type, created_at, started_at, completed_at, current_pick_number, current_round, total_rounds, config',
    )
    .eq('league_id', leagueId)
    .eq('is_mock', true)
    .eq('config->mock->>launched_by' as 'id', userId)
    .in('status', ['live', 'paused', 'complete'])
    .order('created_at', { ascending: false })
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  const rows = data ?? []
  return {
    status: 200,
    body: {
      active: rows.filter((row) => row.status === 'live' || row.status === 'paused'),
      recaps: rows.filter((row) => row.status === 'complete'),
    } as unknown as Json,
  }
}

/** DELETE …/mock-drafts/[did] — launcher-only (the RPC refuses everyone
 *  else, commissioners included); covers abandon AND recap-delete (§8.8). */
export async function deleteMockDraft(
  supabase: Supabase,
  leagueId: string,
  draftId: string,
): Promise<ServiceResult> {
  if (!z.uuid().safeParse(draftId).success) {
    return { status: 404, body: { error: MOCK_NOT_FOUND_MESSAGE } }
  }
  // Scope the id to THIS league under the member SELECT before the RPC —
  // a cross-league id answers the same no-leak 404 an unknown one does.
  const { data: row, error: probeError } = await supabase
    .from('drafts')
    .select('id')
    .eq('league_id', leagueId)
    .eq('id', draftId)
    .eq('is_mock', true)
    .maybeSingle()
  if (probeError) {
    return { status: 500, body: { error: probeError.message } }
  }
  if (!row) {
    return { status: 404, body: { error: MOCK_NOT_FOUND_MESSAGE } }
  }
  const { error } = await supabase.rpc('delete_mock_draft', { p_draft_id: draftId })
  if (error) return mapDraftRpcError(error, NOT_A_MEMBER_MESSAGE)
  return { status: 200, body: { deleted: true, draft_id: draftId } }
}
