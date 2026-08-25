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
 * L.C2.1 (M3) adds the AUCTION verbs (§15.2 nominate/bid rows; §8.6; F64/F65
 * discharged here — see the block's own banner):
 *   - POST …/draft/nominate  → `draft_nominate` (085/089; player_id +
 *     opening_bid + action_id REQUIRED wire-side).
 *   - POST …/draft/bid       → `draft_place_bid` (085/089; amount +
 *     nomination_seq + player_id + action_id ALL REQUIRED — the nomination
 *     identity is never omitted, F64). Every P0001 refusal is product copy
 *     passed through verbatim (the instant "outbid" loser, "just went off
 *     the board", the E5 ceiling) — D136: a friendly 400, never a 429.
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

import {
  draftConfigSchema,
  rosterSettingsSchema,
} from '@/lib/leagues/settings/league-settings'
import type { Database, Draft, Json } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

const NOT_COMMISH_MESSAGE = 'Only the commissioner can manage the draft.'
export const NO_ACTIVE_DRAFT_MESSAGE =
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
    // F77 (L.C3.2): the RPC's OWN message, not "League not found". The league
    // was resolved over RLS one statement ago, so it is exactly the thing
    // that WAS found; what P0002 actually reports is a missing pick, player
    // or franchise ("pick % is not a live pick of this draft",
    // "team % is not an active franchise of this league", "player % not
    // found"). The status stays 404. Safe to pass through: every P0002 in
    // 066/069/072/087/090 is raised AFTER the 42501 no-leak gate, so nothing
    // reaches this arm that the 403 arm does not already cover.
    return { status: 404, body: { error: error.message } }
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
 *
 * `draft_id` (MS.7 — D222/R468): WHICH of the league's drafts the edit
 * targets. Every other draft control already carries one (11/11 across the
 * `…Request(` builders); this body's omission was the R468 mis-target — a
 * mock room had no way to say "my mock", so the service picked the league's
 * REAL active draft and rewrote a negotiated order. Adding exactly ONE named
 * optional key deliberately WIDENS the D95 fence by that key and nothing
 * else — the fence still 400s `draft_scheduled_at` and every other stray
 * key; do not relax this to a passthrough. Absent, the shipped active
 * non-mock probe runs unchanged (every existing caller keeps its behavior).
 */
export const patchDraftInputSchema = z
  .strictObject({
    draft_id: z.uuid().optional(),
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

  // MS.7 (D222/R468): resolve through the ONE resolver every other control
  // uses, not a private probe. Absent `draft_id`, the league arm's probe is
  // the shipped query verbatim (active non-mock over member RLS — 404
  // no-leak, the D95 partial unique guarantees at most one row); present,
  // the row is fetched scoped to THIS league, so a mock room's edit reaches
  // the mock's own draft and `draft_set_order`'s in-body guards finally see
  // it (until MS.2 lands its launcher arm, that guard REFUSES the mock
  // loudly — the correct interim, and strictly better than the silent
  // real-draft rewrite R468 filed). Authority stays in the RPC: the service
  // only picks the target (§12, server-authoritative).
  const resolved = await resolveDraftForAction(supabase, leagueScope(leagueId), parsed.data.draft_id)
  if ('failure' in resolved) {
    return resolved.failure
  }
  const draft = resolved.draft
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

/** The 42501 arm of the STANDALONE launch (MP.4). `create_mock_draft`'s
 *  league arm answers 42501 for "not a member"; its standalone arm answers it
 *  only for `auth.uid() IS NULL`, which the route's own auth gate already
 *  covers — so this is the honest text for a path that should be
 *  unreachable, not a membership message about a league that does not
 *  exist. */
export const MOCK_SIGNED_OUT_MESSAGE = 'Sign in to start a practice draft.'
export const NOT_YOUR_MOCK_MESSAGE =
  "This mock draft is another member's solo practice (§8.8)."
export const LIST_NOT_ATTACHED_MESSAGE = 'That list is not attached to this league.'
/** The standalone arm of the same refusal (MP.6b): a practice draft has no
 *  league to attach a list TO, so what it can load is what the caller owns. */
export const LIST_NOT_YOURS_MESSAGE = 'That list is not one of yours.'
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
 * WHOSE draft an action targets — the ONE thing that differs between a
 * league room and a standalone practice room (MP task MP.6b; D243(5);
 * spec v2.16 §8.8).
 *
 * Every room verb used to take `leagueId: string`, and the whole write path
 * funnels through `resolveDraftForAction`, whose only draft lookup was
 * `.eq('league_id', leagueId)`. A `league_id = <uuid>` predicate can never
 * match NULL, so on a standalone mock (095 dropped the four `NOT NULL`s)
 * pick / nominate / bid / pause / resume / queue all answered 404 — measured
 * in a rolled-back transaction at the MP.6 halt (Q25): 0 rows against every
 * league in the schema, 1 row by draft id alone.
 *
 * The fix is a DISCRIMINATED SCOPE, not a second resolver and not a per-verb
 * branch (D243(5) — "the fork this lane keeps refusing", the LV.7 pattern).
 * The verbs are unchanged below the resolver; the two arms differ only in
 * how the target row is found:
 *
 *   - `league`   — byte-identical to the shipped query (`.eq('league_id',
 *     leagueId)`, optional-`draft_id` probe, the same no-leak 404).
 *   - `standalone-mock` — the mock's OWN id, scoped by `league_id IS NULL`
 *     + the launcher predicate (`config->'mock'->>'launched_by' = the
 *     caller`), which is MS.2's launcher gate expressed the way this layer
 *     already expresses it (`listMyMockDrafts`) — ONE ownership predicate,
 *     never a membership graph (D226(3)).
 *
 * The `league_id IS NULL` conjunct on the standalone arm is LOAD-BEARING and
 * is the answer to the task's own review question (D233(5) one layer up):
 * WITHOUT it the standalone door would reach a league's draft on the
 * launcher predicate alone. `standalone-actions-db.test.ts` §D drives that
 * break RED and the league arm is untouched either way.
 */
export type DraftActionScope =
  | { kind: 'league'; leagueId: string }
  | { kind: 'standalone-mock'; mockId: string; userId: string }

/** The shipped shape: this league's draft. Every league route passes this. */
export const leagueScope = (leagueId: string): DraftActionScope => ({
  kind: 'league',
  leagueId,
})

/** The MP.6b shape: this launcher's league-less practice draft. Only the
 *  `/api/mocks/[mockId]/…` routes pass this. */
export const standaloneMockScope = (mockId: string, userId: string): DraftActionScope => ({
  kind: 'standalone-mock',
  mockId,
  userId,
})

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
  scope: DraftActionScope,
  draftId: string | undefined,
): Promise<{ draft: DraftActionRow } | { failure: ServiceResult }> {
  if (scope.kind === 'standalone-mock') {
    return resolveStandaloneMockForAction(supabase, scope, draftId)
  }
  const base = supabase
    .from('drafts')
    .select('id, status, is_mock, config')
    .eq('league_id', scope.leagueId)
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
 * The standalone arm of the ONE resolver above (MP.6b). Not a second
 * resolver: nothing calls this but `resolveDraftForAction`, and every verb
 * still reaches it through that single door.
 *
 * FOUR conjuncts, and each one is load-bearing:
 *   - `id = <the mock in the URL>` — a standalone mock's id IS the draft id
 *     (there is no league to probe an "active draft" for), so the optional
 *     `draft_id` in the body may only AGREE with the URL. A body naming a
 *     different draft is the same no-leak 404 an unknown id is, never a
 *     second target.
 *   - `league_id IS NULL` — THE conjunct the task's review question is
 *     about. It is what makes this door provably unable to reach a row that
 *     HAS a league, independently of who launched that league's mock.
 *   - `is_mock` — the standalone door is a practice door; a hypothetical
 *     league-less real draft is not reachable through it.
 *   - the launcher predicate, TEXT-compared (R117) — MS.2's gate, reused
 *     verbatim rather than reinvented (D226(3)). RLS already applies it
 *     (095's `drafts` SELECT arm); repeating it here is `listMyMockDrafts`'
 *     belt-and-suspenders for the same reason it gives — the explicit filter
 *     is the one a reader of THIS file can see.
 *
 * Every miss is ONE answer — `MOCK_NOT_FOUND_STANDALONE_MESSAGE`, 404 — so
 * "not yours", "not standalone" and "never existed" are indistinguishable
 * from the wire, the D244(3) property one layer down.
 */
async function resolveStandaloneMockForAction(
  supabase: Supabase,
  scope: { mockId: string; userId: string },
  draftId: string | undefined,
): Promise<{ draft: DraftActionRow } | { failure: ServiceResult }> {
  const notFound: { failure: ServiceResult } = {
    failure: { status: 404, body: { error: MOCK_NOT_FOUND_STANDALONE_MESSAGE } },
  }
  if (!z.uuid().safeParse(scope.mockId).success) return notFound
  if (draftId !== undefined && draftId !== scope.mockId) return notFound

  const { data, error } = await supabase
    .from('drafts')
    .select('id, status, is_mock, config')
    .eq('id', scope.mockId)
    .is('league_id', null)
    .eq('is_mock', true)
    .eq('config->mock->>launched_by' as 'id', scope.userId)
    .maybeSingle()
  if (error) {
    return { failure: { status: 500, body: { error: error.message } } }
  }
  if (!data) return notFound
  return { draft: data as DraftActionRow }
}

/**
 * THE CALLER'S ACTING SEAT — which franchise this request acts FOR.
 *
 * Real draft → the caller's own seat (`league_members.team_id`). Mock draft
 * → the LAUNCHER acts for the HUMAN seat and nobody else touches it (D103(3);
 * the seat's chosen franchise may not be the caller's own).
 *
 * That rule is not this layer's invention — it is the RPCs' own team
 * resolution, mirrored: `draft_nominate` (089:1201/1203) and
 * `draft_place_bid` (089:1476/1478) each read `config.mock.human_team_id`
 * on a mock and `league_members.team_id` otherwise, and `draft_queue_replace`
 * writes under the 065 "Own queue write" policy. Two consumers:
 *   - the queue writers (§12.6 "a manager sees/edits only their own queue" —
 *     the 065 policy is the RLS backstop), and
 *   - the auction verbs' F65 response-integrity check (R420), where it is
 *     the DISCRIMINATOR: the acting seat is the one fact about a submit that
 *     a forger cannot read off the wire, because `draft_bids` is readable by
 *     every league member (083:132–133 — `FOR SELECT USING
 *     (is_league_member(league_id))`, no column restriction) while seat
 *     ownership is the caller's identity.
 */
async function resolveActingSeat(
  supabase: Supabase,
  scope: DraftActionScope,
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
  if (scope.kind !== 'league') {
    // Unreachable by construction: the standalone arm of the resolver above
    // filters `is_mock`, so a non-mock row can never arrive here on a
    // standalone scope. Answered as the same no-leak 404 rather than left to
    // a non-null assertion (MP.6b).
    return { failure: { status: 404, body: { error: MOCK_NOT_FOUND_STANDALONE_MESSAGE } } }
  }
  const { data: seat, error } = await supabase
    .from('league_members')
    .select('team_id')
    .eq('league_id', scope.leagueId)
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
  scope: DraftActionScope,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = makePickInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, scope, parsed.data.draft_id)
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
// POST /api/leagues/[id]/draft/nominate + …/draft/bid — the auction verbs
// (§15.2 → draft_nominate / draft_place_bid; M3 task L.C2.1; F64 + F65)
// ---------------------------------------------------------------------------
//
// Thin wrappers over migration 085's two auction RPCs (as re-emitted by
// 089 — the mock launcher gate + the extracted bid internal): the RPCs own
// turn/phase/availability/max-bid/anti-snipe/E2 under the §4.6 drafts-row
// lock; this layer parses, resolves the target draft (the makePick
// pattern — optional `draft_id`, active-non-mock default; a mock room
// sends its own id and the same verbs serve it, D138/089), maps SQLSTATEs
// (the 063 convention — every P0001 refusal is PRODUCT COPY passed through
// verbatim: "outbid at $N", "just went off the board", the E5 ceiling with
// the formula's numbers; D136: the race loser is a friendly 400, never a
// 429), and enforces the two client-side contracts the RPC deliberately
// left to the mint site:
//
//  - F64 — A BID ALWAYS NAMES THE NOMINATION IT WAS PLACED ON.
//    `draft_place_bid`'s identity arguments (`p_nomination_seq`,
//    `p_player_id`) are OPTIONAL at the RPC so that landing them broke no
//    caller (R330/D157(10)); a route that omitted them would re-open the
//    defect in full — a bid in flight across a nomination boundary lands on
//    whatever player is live when it executes. So `placeBidInputSchema`
//    REQUIRES `nomination_seq` + `player_id` (the client sends what ITS
//    ROOM IS LOOKING AT, never what the server is), and `placeBid` passes
//    both through on every call. A stale identity gets the RPC's §16.3
//    "just went off the board" copy as a 400 — a race-loser message.
//
//  - F65 — ACTION IDS ARE MINTED PER VERB AND NEVER SHARED. 085's E2
//    replay lookup is `(draft_id, action_id)` with NO verb discrimination
//    (and the three in-body fixes were each rejected for a standing
//    reason — D157(11)/R331: narrowing re-opens a raw 23505 on the partial
//    unique; argument-consistency in the RPC contradicts R125 and the two
//    shipped 034 E2 pins; position inference breaks under D143's
//    cancel-and-renominate). The contract therefore lives HERE, in two
//    halves. (a) The MINT: `useNominate`/`usePlaceBid` (use-draft-auction.ts)
//    each stamp a FRESH uuid per submit inside their own wrapper (the
//    D68(1) pattern, `useMakePick`'s shape) — no id is ever reused across
//    `nominate` and `bid`, nor re-sent from a different endpoint; the
//    schemas REQUIRE it wire-side (NULL is never sent). (b) THE RESPONSE-
//    INTEGRITY CHECK: a replay returns the ORIGINAL row (R125 — the RPC is
//    untouched), and for a legitimate retry that row IS the submit being
//    retried (React Query re-sends the same variables), so the returned row
//    must be THIS caller's THIS submit. Two conditions, and the FIRST is the
//    load-bearing one (R420):
//      * IDENTITY — `bid.team_id` must equal the caller's ACTING SEAT
//        (`resolveActingSeat`: own `league_members.team_id`, or on a mock
//        `config.mock.human_team_id`, which is exactly how the RPCs pick the
//        team they write — 089:1201/1476). This is the discriminator that
//        cannot be forged: `draft_bids` is readable by EVERY league member
//        (083:132–133, no column restriction), so a member can read any
//        row's `action_id`, `player_id`, `amount` and `nomination_seq` and
//        replay them back. Seat ownership is the one thing they cannot
//        supply. Comparing arguments ALONE left F65's live-proven false
//        success reachable — a non-nominator POSTing another manager's
//        action_id with that row's own (player, amount) got a 200 carrying
//        that manager's bid row.
//      * ARGUMENTS — the returned (nomination_seq, player_id, amount), or
//        (player_id, opening_bid) for a nomination, must equal the request's.
//        This catches the caller reusing their OWN id across verbs, where
//        the seat matches by construction.
//    Either mismatch means the id was consumed by a DIFFERENT action, so the
//    service refuses with a 409 instead of answering 200 with a "bid" the
//    caller never placed — the CLAUDE.md "never let nothing happened mean it
//    worked" rule at this boundary. A same-submit retry (same caller,
//    identical variables) always passes; a double-tap mints a fresh id per
//    tap and is a NEW bid, not a replay.
//    COST, stated plainly: the seat lookup is ONE extra indexed SELECT on
//    the success path of every nominate/bid. Paid deliberately — a bid is a
//    human gesture, not a hot loop, and the claim this check makes is only
//    worth making if it holds against a caller who reads the wire.
//
// Never optimistic (§15.6): the response is returned for the hook to
// settle on; the feed and the drafts broadcast are the room's truth (D184).
// No budget math here — `draft_team_budget` (084) is the one authority and
// is revoked from `authenticated`; the client's TS mirror
// (components/draft/auction-budget.ts) is display-only, parity-pinned.

/** int4 domain — a shape bound only; every PRODUCT bound (min bid, the
 *  max-bid ceiling, integer raises) is the RPC's, with its own copy. */
const INT4_MAX = 2_147_483_647

/** The 409's product copy (R421). Names no internal identifier — this
 *  string reaches a manager mid-auction verbatim (`client-fetch.ts:52`
 *  surfaces a string `error` body as `LeagueActionError.message`, and
 *  `use-draft-auction.ts` tells callers to show it as-is), so §16.3's
 *  friendly-race-resolution rule and tasks-M3 §4 rule 8 both apply. The
 *  remedy has to WORK: an action_id is consumed forever (R125), so
 *  re-submitting THIS one returns the same 409 every time — the copy
 *  therefore asks for a fresh gesture (which mints a fresh id), never for a
 *  retry of the submit that failed. */
export const ACTION_ID_REUSED_MESSAGE =
  "That didn't go through — we couldn't confirm it as yours. Check the player and the price, then place it again."

/** `action_id` REQUIRED wire-side (E2/D68(1)): the hook mints one UUID per
 *  submit, so a retry replays instead of double-nominating. */
export const nominateInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  player_id: z.string().trim().min(1),
  opening_bid: z.number().int().min(0).max(INT4_MAX),
  action_id: z.uuid(),
})
export type NominateInput = z.infer<typeof nominateInputSchema>

/** F64: `nomination_seq` + `player_id` REQUIRED — the bid names the
 *  nomination the client was looking at. `action_id` REQUIRED (E2/D68(1)). */
export const placeBidInputSchema = z.strictObject({
  draft_id: z.uuid().optional(),
  nomination_seq: z.number().int().min(1),
  player_id: z.string().trim().min(1),
  amount: z.number().int().min(0).max(INT4_MAX),
  action_id: z.uuid(),
})
export type PlaceBidInput = z.infer<typeof placeBidInputSchema>

/** The RPCs' §8.1 step-5 payload: the authoritative drafts row + the bid
 *  row this call wrote (or, on an E2 replay, the ORIGINAL row). */
export interface AuctionActionBody {
  draft: Draft
  bid: Database['public']['Tables']['draft_bids']['Row']
}

export async function nominatePlayer(
  supabase: Supabase,
  scope: DraftActionScope,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = nominateInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, scope, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure

  const { data, error } = await supabase.rpc('draft_nominate', {
    p_draft_id: resolved.draft.id,
    p_player_id: parsed.data.player_id,
    p_opening_bid: parsed.data.opening_bid,
    p_action_id: parsed.data.action_id,
  })
  if (error) return mapDraftRpcError(error, NOT_A_MEMBER_MESSAGE)
  const body = data as unknown as AuctionActionBody

  // F65(b): the row that came back must be THIS caller's THIS nomination
  // (fresh, or the same submit replayed) — otherwise the action_id was
  // consumed by another action, and answering 200 would attribute someone
  // else's row to this caller. Identity FIRST (R420): the acting seat is the
  // fact a member reading `draft_bids` cannot forge; the arguments catch a
  // caller reusing their OWN id across verbs.
  const seat = await resolveActingSeat(supabase, scope, userId, resolved.draft)
  if ('failure' in seat) return seat.failure
  if (
    body.bid.team_id !== seat.teamId ||
    body.bid.player_id !== parsed.data.player_id ||
    body.bid.amount !== parsed.data.opening_bid
  ) {
    return { status: 409, body: { error: ACTION_ID_REUSED_MESSAGE } }
  }
  // Fresh nomination and the E2 replay are BOTH 200 (the replayed-submit
  // convention — the client cannot tell a retried submit from its original).
  return { status: 200, body: body as unknown as Json }
}

export async function placeBid(
  supabase: Supabase,
  scope: DraftActionScope,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = placeBidInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, scope, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure

  // F64: the nomination identity rides EVERY call — never omitted, never
  // derived server-side from what happens to be live.
  const { data, error } = await supabase.rpc('draft_place_bid', {
    p_draft_id: resolved.draft.id,
    p_amount: parsed.data.amount,
    p_action_id: parsed.data.action_id,
    p_nomination_seq: parsed.data.nomination_seq,
    p_player_id: parsed.data.player_id,
  })
  if (error) return mapDraftRpcError(error, NOT_A_MEMBER_MESSAGE)
  const body = data as unknown as AuctionActionBody

  // F65(b): the row that came back must be THIS caller's THIS bid (fresh, or
  // the same submit replayed — R338: a retry after the nomination moved on
  // returns its original row, which still matches on both counts) —
  // otherwise the action_id was a nomination's, or another manager's, and
  // the caller never placed it. Identity FIRST (R420).
  const seat = await resolveActingSeat(supabase, scope, userId, resolved.draft)
  if ('failure' in seat) return seat.failure
  if (
    body.bid.team_id !== seat.teamId ||
    body.bid.nomination_seq !== parsed.data.nomination_seq ||
    body.bid.player_id !== parsed.data.player_id ||
    body.bid.amount !== parsed.data.amount
  ) {
    return { status: 409, body: { error: ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: body as unknown as Json }
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
  scope: DraftActionScope,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = upsertQueueInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const resolved = await resolveDraftForAction(supabase, scope, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure
  const seat = await resolveActingSeat(supabase, scope, userId, resolved.draft)
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
  scope: DraftActionScope,
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

  const resolved = await resolveDraftForAction(supabase, scope, parsed.data.draft_id)
  if ('failure' in resolved) return resolved.failure
  const seat = await resolveActingSeat(supabase, scope, userId, resolved.draft)
  if ('failure' in seat) return seat.failure

  // WHICH LISTS THIS VERB WILL LOAD, and the two arms answer it differently
  // because §8.9's own scoping mechanism is the league tag (MP.6b).
  //
  //  - LEAGUE (unchanged, byte for byte): the list must be ATTACHED to this
  //    league and visible to the caller (own attachment or a league-shared
  //    one — the 067 RLS scope). Invisible ≡ not attached (no-leak 404).
  //  - STANDALONE: there is no league to tag a list to, so the scope is the
  //    only one left and it is the one §8.8 v2.16 names — OWNERSHIP. The
  //    caller may load a list they OWN, and nothing else. Narrower than the
  //    league arm on purpose: a public list somebody else owns is readable
  //    under `lists` RLS, and admitting it here would be a rule this task
  //    invented rather than one the spec ruled. Widening it later is
  //    additive; the room's list PICKER is MP.6c's surface question.
  const listCheck =
    scope.kind === 'league'
      ? await supabase
          .from('league_lists')
          .select('id, list_id')
          .eq('league_id', scope.leagueId)
          .eq('list_id', listId)
          .maybeSingle()
      : await supabase
          .from('lists')
          .select('id')
          .eq('id', listId)
          .eq('owner_id', scope.userId)
          .is('deleted_at', null)
          .maybeSingle()
  if (listCheck.error) {
    return { status: 500, body: { error: listCheck.error.message } }
  }
  if (!listCheck.data) {
    return {
      status: 404,
      body: {
        error:
          scope.kind === 'league' ? LIST_NOT_ATTACHED_MESSAGE : LIST_NOT_YOURS_MESSAGE,
      },
    }
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

/** R516: the league-free door's own voice. The message above names a league,
 *  which is false on `/api/mocks/[mockId]` — there is no league in the
 *  question there, and a user told "in this league" about a standalone
 *  practice draft has been handed a smaller version of the same mistake this
 *  whole lane exists to correct. */
export const MOCK_NOT_FOUND_STANDALONE_MESSAGE = 'No such practice draft.'

/** R516: the 42501 fallback for the league-free delete door. NOT
 *  `MOCK_SIGNED_OUT_MESSAGE` — that route already answers 401 before the RPC
 *  is reached, so "Sign in…" can only ever be wrong there. `delete_mock_draft`
 *  is launcher-keyed (D110(1)), so 42501 means exactly this. */
export const MOCK_NOT_YOURS_MESSAGE = "That practice draft isn't yours to delete."


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
 *  `min(0)` is the shape floor: $0 is a legal price in a league that allows
 *  $0 nominations (`auction_zero_dollar_nominations` — 092/AP.1, §7.3.8), and
 *  "below this league's $N price floor" is the RPC's own refusal. */
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
  scope: DraftActionScope,
  rawBody: unknown,
  schema: S,
  rpc: (body: z.infer<S>, draftId: string) => { fn: ControlRpcName; args: ControlArgs },
): Promise<ServiceResult> {
  const parsed = schema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const body = parsed.data as z.infer<S> & { draft_id?: string; reason?: string }
  const resolved = await resolveDraftForAction(supabase, scope, body.draft_id)
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
  scope: DraftActionScope,
  rawBody: unknown,
): Promise<ServiceResult> {
  return dispatchControl(supabase, scope, rawBody, pauseDraftInputSchema, (body, draftId) => ({
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, undoDraftInputSchema, (body, draftId) => ({
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
    leagueScope(leagueId),
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, forcePickInputSchema, (body, draftId) => ({
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, movePlayerInputSchema, (body, draftId) => ({
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, resetDraftInputSchema, (body, draftId) => ({
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, setClockInputSchema, (body, draftId) => ({
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
  // 099/AP.6 (E69, discharges F82): REQUIRED wire-side — the D68(1)/D114(4)
  // contract, the force-pick precedent. The RPC dedupes a retried POST on it
  // and replays the ORIGINAL result; only unstamped non-route callers
  // (tests, psql) pass SQL NULL.
  action_id: z.uuid(),
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
    leagueScope(leagueId),
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, adjustBudgetInputSchema, (body, draftId) => ({
    fn: 'draft_adjust_budget',
    args: {
      p_draft_id: draftId,
      p_team_id: body.team_id,
      p_delta: body.delta,
      p_reason: body.reason,
      p_action_id: body.action_id,
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
    leagueScope(leagueId),
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
  return dispatchControl(supabase, leagueScope(leagueId), rawBody, endDraftInputSchema, (body, draftId) => ({
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

// ---------------------------------------------------------------------------
// POST /api/mocks — launch a STANDALONE practice draft (MP task MP.4)
// ---------------------------------------------------------------------------

/**
 * The settings OBJECT `create_mock_draft`'s standalone arm takes (095 §7;
 * tasks-MP §4 rule 12 / D229(5)).
 *
 * Parsed with the league contract's OWN schemas — `rosterSettingsSchema` and
 * `draftConfigSchema`, the same two `leagueSettingsSchema` composes — because
 * this object IS a league's three settings fields under different cover
 * (`leagues.team_count`, `leagues.roster_settings`,
 * `leagues.settings->'draft'`). That is what makes the deferred league-mock
 * feature a new SOURCE for this object rather than a rewrite of this path,
 * and it is why MP.4 exported `draftConfigSchema` instead of restating its
 * ranges: a second copy of the §7.3.8 catalog here would drift from the one
 * every league surface validates against.
 *
 * `scoring_system_id` (D229(1): pick one of the six shipped templates at
 * launch) rides the draft block, so it lands in `drafts.config` beside
 * MP.2's `config->'roster'` with NO RPC signature change — exactly the seam
 * D236(4) predicted. It is not range-checked in the database: a forged id
 * resolves to no template row and the launcher's own board renders "—" for
 * the projection columns (§16.5.4's "never wrong numbers"), which harms
 * nobody but the forger's own practice — tasks-MP §4 rule 10 forbids a
 * protection with no party to protect. Shape IS checked (a uuid), because a
 * non-uuid would be stored and read back by a column-typed client.
 *
 * NOT the authority on the ranges either: `draft_settings_range_guard`
 * (095 §2) re-checks every clock, the budget and the roster bounds in-body,
 * because `create_mock_draft` is EXECUTE-able by `authenticated` and a
 * client that skips this route reaches it directly (MP.4 item 5).
 */
export const standaloneMockSettingsSchema = z.strictObject({
  team_count: z.literal([8, 10, 12, 14, 16]),
  roster_settings: rosterSettingsSchema,
  draft: draftConfigSchema.extend({ scoring_system_id: z.uuid() }),
})

/**
 * The wire payload, inferred from the schema that validates it (R510). It
 * lives HERE, with the route contract, rather than in a component module:
 * `use-mock-drafts.ts` needs it, and a hook importing its request type from
 * a component inverts the layering. `mock-launch-ops` imports it back — the
 * ops layer BUILDS this object, it does not define it.
 */
export type StandaloneMockSettings = z.infer<typeof standaloneMockSettingsSchema>

export const launchStandaloneMockInputSchema = z.strictObject({
  cpu_speed: z.enum(['realistic', 'fast']).optional(),
  settings: standaloneMockSettingsSchema,
  /** Hook-minted per submit (D68(1)); the route mints otherwise — the RPC
   *  ALWAYS receives a key (D110(11)). */
  action_id: z.uuid().optional(),
})

/**
 * POST /api/mocks — a practice draft with NO league (spec v2.16 §8.8;
 * D226/D227/D234/D237). `p_league_id` and `p_human_team_id` are deliberately
 * NOT sent: the two arms of `create_mock_draft` are mutually exclusive BY
 * REFUSAL (095), so sending either alongside `p_settings` is a 22023 rather
 * than a silent precedence guess. Every rule stays the RPC's — the §22.5
 * caps, the seat minting, the solvency backstop — and its refusals surface
 * verbatim (they were written to be read by the launcher).
 */
export async function launchStandaloneMockDraft(
  supabase: Supabase,
  rawBody: unknown,
  deps: LaunchMockDeps,
): Promise<ServiceResult> {
  const parsed = launchStandaloneMockInputSchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('create_mock_draft', {
    p_cpu_speed: parsed.data.cpu_speed ?? 'realistic',
    p_action_id: parsed.data.action_id ?? deps.mintActionId(),
    p_settings: parsed.data.settings as unknown as Json,
  })
  if (error) return mapDraftRpcError(error, MOCK_SIGNED_OUT_MESSAGE)
  const result = data as unknown as DraftStateBody
  return { status: result.created ? 201 : 200, body: result as unknown as Json }
}

/**
 * The `drafts` projection BOTH mock lists read. One constant, because the
 * two endpoints answer different QUESTIONS but must describe a mock the same
 * way — a second column list here is how two surfaces start disagreeing
 * about what a practice draft is.
 *
 * `league_id` joins the league route's original selection and is the ONE
 * addition (MP.5): the practice home lists mocks with and without a league,
 * and `MockRow`'s league-optional arm has to know which it is holding. It is
 * not decoration — a stored field nobody reads is D236(4)'s failure — it is
 * the discriminant the row branches on.
 */
const MOCK_LIST_COLUMNS =
  'id, league_id, status, draft_type, created_at, started_at, completed_at, current_pick_number, current_round, total_rounds, config'

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
    .select(MOCK_LIST_COLUMNS)
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

/**
 * GET /api/mocks — EVERY mock this user launched, league-attached or not
 * (MP task MP.5; spec v2.16 §8.8 "practice is the purpose, a league is
 * optional context"). The `/app/mocks` practice home's read.
 *
 * **Deliberately not `listMockDrafts` widened to mean "all".** That function
 * answers *"my practice drafts for THIS league"* and its whole shape is the
 * league id; this answers *"my practice drafts"*, and there is no league in
 * the question. Two questions, two endpoints (the rule `POST /api/mocks`
 * already states from the launch side).
 *
 * Launcher-scoped BOTH ways, belt and suspenders. RLS already does it — the
 * D234/095 ownership arm is `league_id IS NULL AND config->mock->>launched_by
 * = auth.uid()` for a standalone mock, league membership for an attached one
 * — and the `launched_by` filter below repeats it explicitly, because a
 * league mock is visible to a MEMBER under RLS and only its launcher owns it
 * (D110(1)). Without the explicit filter this endpoint would leak a
 * league-mate's practice.
 */
export async function listMyMockDrafts(
  supabase: Supabase,
  userId: string,
): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('drafts')
    .select(MOCK_LIST_COLUMNS)
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

/**
 * DELETE /api/mocks/[mockId] — abandon a standalone practice draft or delete
 * its report (MP.5). The league sibling below scopes the id to a league
 * before calling the RPC; this scopes it to "has no league", so a
 * league-attached id answers the same no-leak 404 an unknown one does and
 * cannot be deleted through the door that has no league to check.
 *
 * Every rule is still `delete_mock_draft`'s (095): launcher-only, draft
 * first then the bot `teams` rows it minted, `league_id IS NULL` + owner on
 * the seat sweep.
 */
export async function deleteStandaloneMockDraft(
  supabase: Supabase,
  draftId: string,
): Promise<ServiceResult> {
  if (!z.uuid().safeParse(draftId).success) {
    return { status: 404, body: { error: MOCK_NOT_FOUND_STANDALONE_MESSAGE } }
  }
  const { data: row, error: probeError } = await supabase
    .from('drafts')
    .select('id')
    .is('league_id', null)
    .eq('id', draftId)
    .eq('is_mock', true)
    .maybeSingle()
  if (probeError) {
    return { status: 500, body: { error: probeError.message } }
  }
  if (!row) {
    return { status: 404, body: { error: MOCK_NOT_FOUND_STANDALONE_MESSAGE } }
  }
  const { error } = await supabase.rpc('delete_mock_draft', { p_draft_id: draftId })
  if (error) return mapDraftRpcError(error, MOCK_NOT_YOURS_MESSAGE)
  return { status: 200, body: { deleted: true, draft_id: draftId } }
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
