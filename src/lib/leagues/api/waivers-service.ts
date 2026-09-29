/**
 * Waivers service — M5 task L.D2.12 (spec §13.2, §15.3; tasks-M5 §5's route
 * sketch; migration 145's `waiver_claim_submit` / `_cancel` / `_reorder`;
 * PROGRESS D383, D387).
 *
 *   POST   /api/leagues/[id]/waivers          submit a blind claim
 *   GET    /api/leagues/[id]/waivers          a team's claims (default: mine, pending)
 *   PATCH  /api/leagues/[id]/waivers/[cid]    move one claim to a new place in its team's order
 *                                             — or, with { faab_bid, drop_player_id }, change
 *                                             its bid / drop in place (150's edit verb, F417)
 *   DELETE /api/leagues/[id]/waivers/[cid]    cancel one claim
 *
 * Same D68/D71 layering as the rest of the in-season family: the Route
 * Handlers are auth + param plumbing, and everything testable lives here over
 * an INJECTED client so the stack suite (`waivers-api-db.test.ts`) drives the
 * production composition across the real PostgREST wire.
 *
 * **The whole verb is the RPC's** (server-authoritative — CLAUDE.md). Who may
 * claim for a team (its manager, or a commissioner for ANY team — TD5), the
 * season gate, exclusivity, the bid rules (≥ `faab_min_bid`, ≤ the balance,
 * $0 under a priority type), the identical-pending-claim refusal and the
 * blind-safe commissioner receipt are all 145's, under the league row lock.
 * This layer owns the wire shape, the idempotency stamp, the F65(b) identity
 * guard and making a refusal readable (`inseason-errors.ts`, verbatim).
 *
 * **F65(b) — 145's replay is verb- and team-scoped, not ARGUMENT-scoped.** A
 * reused `action_id` naming a different player / drop / bid replays the FIRST
 * submit's document with no error; answering 200 would report a claim nobody
 * made. Each write below compares the echo with what was sent and answers 409
 * on a mismatch. Uuids are lower-cased at the schema (R768, `inseason-ids.ts`).
 *
 * **Blind bids (E13, TD3).** `waiver_claims` is readable only by the claim's
 * team's manager and the league's commissioners (145's one SELECT policy). The
 * GET never lets that RLS emptiness speak for itself (CLAUDE.md "never let
 * 'nothing happened' mean 'it worked'"): a non-member is the family's 403
 * (`assertLeagueMember`), and a member asking for ANOTHER team's claims is a
 * 403 by name — never an empty list that reads as "they have no claims".
 *
 * **Reorder = "move this claim to place N" (PATCH …/[cid]).** 145's verb takes
 * the team's WHOLE pending order; this route reads that order (RLS — the
 * caller can see it because it can see the claim), moves [cid] to
 * `claim_order`, and hands the full list to the verb, whose exact-set check
 * refuses by name if a claim was added, cancelled or settled in between. A
 * claim the caller cannot see answers the same no-leak 403 145 gives
 * (nonexistent and another team's alike).
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): every `action_id` is minted per gesture by the HOOK.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** Postgres INTEGER's ceiling — `faab_bid` / `faab_balance` are INTEGER, so a
 *  larger number is a clean 400 here, never a raw out-of-range error (R1172). */
export const PG_INT_MAX = 2147483647

/** The 42501 arm's copy for the three claim verbs — ONE no-leak string for
 *  "no such league / not a member / not this team's manager and not the
 *  commissioner / no such claim" alike (145 raises one 42501 for all). */
export const WAIVER_CLAIM_FORBIDDEN_MESSAGE =
  'Only this team’s manager (or the league’s commissioner) can manage its waiver claims.'

/** The GET's refusal for a member asking to see ANOTHER team's claims — bids
 *  are blind (E13), so this is refused by name rather than answered empty. */
export const WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE =
  'Waiver claims are private — only the team’s manager and the league’s commissioner can see them.'

/** The GET when the caller manages no team and named none. */
export const WAIVER_CLAIMS_NO_TEAM_MESSAGE = 'You don’t manage a team in this league — name the team whose claims you want to see.'

/** The 409 for a REUSED action_id naming a different request (F65(b)). */
export const WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the claim change you just made. Check your claims and try again.'

/** `players.id` is TEXT (the provider's id) — a shape ceiling, not product law;
 *  which ids exist is 145's question (a named P0001). */
const playerId = z.string().trim().min(1).max(64)

/** A whole-dollar amount the database can store (R1172: 0 … INTEGER max). */
const wholeDollars = z.number().int().min(0).max(PG_INT_MAX)

// ---------------------------------------------------------------------------
// POST …/waivers — submit
// ---------------------------------------------------------------------------

export const submitClaimInputSchema = z
  .strictObject({
    team_id: normalizedUuid,
    add_player_id: playerId,
    drop_player_id: playerId.nullish(),
    /** Absent = $0 (145's `COALESCE(p_bid, 0)`); a priority league refuses
     *  anything else by name. */
    faab_bid: wholeDollars.optional(),
    action_id: normalizedUuid,
    /** Stored only on the commissioner arm (Q66: optional). */
    reason: optionalReason,
  })
  .refine((body) => body.drop_player_id == null || body.drop_player_id !== body.add_player_id, {
    message: 'The player to drop can’t be the player you’re claiming.',
    path: ['drop_player_id'],
  })
export type SubmitClaimInput = z.infer<typeof submitClaimInputSchema>

/** 145's submit document (`145:512-542`), returned whole. */
export interface SubmitClaimResult {
  verb: 'waiver_claim_submit'
  league_id: string
  team_id: string
  team_name: string
  action_id: string
  season: number
  claim: {
    id: string
    add_player_id: string
    drop_player_id: string | null
    faab_bid: number
    claim_order: number
    status: string
    process_at: string | null
    created_at: string
  }
  add_player_name: string | null
  drop_player_name: string | null
  waiver_type: string
  faab_min_bid: number | null
  faab_balance: number | null
  faab_spent: 0
  faab_spent_why: string
  settled_by: string
  acted_as_commissioner: boolean
  commissioner_action_id: string | null
  system_post: string | null
  notified_user_id: string | null
  reason: string | null
  evaluated_at: string
}

interface SubmitEchoShape {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  claim?: { add_player_id?: unknown; drop_player_id?: unknown; faab_bid?: unknown } | null
}

export async function submitClaim(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = submitClaimInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, add_player_id, drop_player_id, faab_bid, action_id, reason } = parsed.data

  // Optional args are OMITTED rather than sent as null (145 defaults each).
  const { data, error } = await supabase.rpc('waiver_claim_submit', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_add: add_player_id,
    ...(drop_player_id ? { p_drop: drop_player_id } : {}),
    ...(faab_bid === undefined ? {} : { p_bid: faab_bid }),
    p_action_id: action_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    return mapInSeasonRpcError(error, WAIVER_CLAIM_FORBIDDEN_MESSAGE)
  }

  // F65(b): the claim that came back must be THIS submit (fresh or replayed).
  const echo = (data ?? {}) as SubmitEchoShape
  if (
    echo.verb !== 'waiver_claim_submit' ||
    echo.action_id !== action_id ||
    echo.team_id !== team_id ||
    echo.claim?.add_player_id !== add_player_id ||
    (echo.claim?.drop_player_id ?? null) !== (drop_player_id ?? null) ||
    echo.claim?.faab_bid !== (faab_bid ?? 0)
  ) {
    return { status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// GET …/waivers — a team's claims
// ---------------------------------------------------------------------------

export const readClaimsQuerySchema = z.strictObject({
  /** `pending` (default — §15.3's "my pending claims") or `all` (won / lost /
   *  invalid / cancelled too, with `result_reason` — the claims panel). */
  status: z.enum(['pending', 'all']).default('pending'),
  /** Absent = the caller's own team. A commissioner may name any team. */
  team_id: z.uuid().optional(),
})

export interface WaiverClaimPlayer {
  player_id: string
  full_name: string | null
  position: string | null
  nfl_team: string | null
}

export interface WaiverClaimView {
  id: string
  team_id: string
  add: WaiverClaimPlayer
  drop: WaiverClaimPlayer | null
  faab_bid: number
  claim_order: number
  status: 'pending' | 'won' | 'lost' | 'invalid' | 'cancelled'
  /** Why it settled as it did (`outbid`, `roster_full`, `cancelled`, … — 145
   *  column; the processor, L.D2.9, writes the run outcomes). */
  result_reason: string | null
  process_at: string | null
  processed_at: string | null
  created_at: string
  created_by: string
  cancelled_at: string | null
}

export interface WaiverClaimsDocument {
  league_id: string
  team_id: string
  status: 'pending' | 'all'
  waiver_type: string | null
  faab_budget: number | null
  faab_min_bid: number
  /** The team's seat's balance / priority (TD2 / TD8) — null when unset. */
  faab_balance: number | null
  waiver_priority: number | null
  /** L.D2.18: the STORED `settings.faab_tiebreaker` (null = no key — the
   *  default, rolling), so the panel can say whether the stored order breaks
   *  equal bids (`waiverOrderCopy`). Optional so older fixtures stay valid. */
  faab_tiebreaker?: string | null
  /** Pending first in the team's own order (claim_order), then settled ones
   *  newest first. */
  claims: WaiverClaimView[]
}

export async function readClaims(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = readClaimsQuerySchema.safeParse(rawQuery ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { status } = parsed.data

  // The family's gate FIRST (R807): a non-member is refused by name, never
  // handed an empty list.
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const [seatRes, commishRes, leagueRes] = await Promise.all([
    supabase.from('league_members').select('team_id').eq('league_id', leagueId).eq('user_id', userId).maybeSingle(),
    supabase.rpc('is_league_commish', { p_league_id: leagueId }),
    supabase.from('leagues').select('waiver_type, faab_budget, settings').eq('id', leagueId).is('deleted_at', null).maybeSingle(),
  ])
  if (seatRes.error) return { status: 500, body: { error: `league_members: ${seatRes.error.message}` } }
  if (commishRes.error) return { status: 500, body: { error: `is_league_commish: ${commishRes.error.message}` } }
  if (leagueRes.error) return { status: 500, body: { error: `leagues: ${leagueRes.error.message}` } }
  if (!leagueRes.data) {
    return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
  }

  const ownTeam = seatRes.data?.team_id ?? null
  const teamId = parsed.data.team_id?.toLowerCase() ?? ownTeam
  if (!teamId) {
    return { status: 400, body: { error: WAIVER_CLAIMS_NO_TEAM_MESSAGE } }
  }
  // Blind bids: another team's claims are the commissioner's to read, and
  // nobody else's — refused by NAME, never answered with RLS's empty list.
  if (teamId !== ownTeam && commishRes.data !== true) {
    return { status: 403, body: { error: WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE } }
  }

  const [teamRes, teamSeatRes] = await Promise.all([
    supabase.from('teams').select('id').eq('id', teamId).eq('league_id', leagueId).maybeSingle(),
    supabase.from('league_members').select('faab_balance, waiver_priority').eq('league_id', leagueId).eq('team_id', teamId).maybeSingle(),
  ])
  if (teamRes.error) return { status: 500, body: { error: `teams: ${teamRes.error.message}` } }
  if (teamSeatRes.error) return { status: 500, body: { error: `league_members: ${teamSeatRes.error.message}` } }
  if (!teamRes.data) {
    return { status: 404, body: { error: 'That team isn’t part of this league.' } }
  }

  let claimsQuery = supabase
    .from('waiver_claims')
    .select(
      'id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, status, result_reason, process_at, processed_at, created_at, created_by, cancelled_at',
    )
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (status === 'pending') claimsQuery = claimsQuery.eq('status', 'pending')
  const { data: claimRows, error: claimsError } = await claimsQuery
  if (claimsError) return { status: 500, body: { error: `waiver_claims: ${claimsError.message}` } }
  const rows = claimRows ?? []
  const capped = assertBelowPostgrestCap(rows, 'waiver_claims')
  if (capped) return capped

  const playerIds = [...new Set(rows.flatMap((r) => (r.drop_player_id ? [r.add_player_id, r.drop_player_id] : [r.add_player_id])))]
  const playersById = new Map<string, { full_name: string; position: string; team: string | null }>()
  if (playerIds.length > 0) {
    const { data: players, error } = await supabase.from('players').select('id, full_name, position, team').in('id', playerIds)
    if (error) return { status: 500, body: { error: `players: ${error.message}` } }
    for (const p of players ?? []) playersById.set(p.id, p)
  }
  const player = (id: string): WaiverClaimPlayer => {
    const p = playersById.get(id)
    return { player_id: id, full_name: p?.full_name ?? null, position: p?.position ?? null, nfl_team: p?.team ?? null }
  }

  const claims: WaiverClaimView[] = rows.map((r) => ({
    id: r.id,
    team_id: r.team_id,
    add: player(r.add_player_id),
    drop: r.drop_player_id ? player(r.drop_player_id) : null,
    faab_bid: r.faab_bid,
    claim_order: r.claim_order,
    status: r.status as WaiverClaimView['status'],
    result_reason: r.result_reason,
    process_at: r.process_at,
    processed_at: r.processed_at,
    created_at: r.created_at,
    created_by: r.created_by,
    cancelled_at: r.cancelled_at,
  }))
  // Pending first in the team's own order; settled ones stay newest first
  // (the read's order — Array.prototype.sort is stable).
  claims.sort((a, b) => {
    const ap = a.status === 'pending'
    const bp = b.status === 'pending'
    if (ap && bp) return a.claim_order - b.claim_order
    if (ap !== bp) return ap ? -1 : 1
    return 0
  })

  const settings = (leagueRes.data.settings ?? {}) as Record<string, unknown>
  const minBid = typeof settings.faab_min_bid === 'number' ? settings.faab_min_bid : 0
  const doc: WaiverClaimsDocument = {
    league_id: leagueId,
    team_id: teamId,
    status,
    waiver_type: leagueRes.data.waiver_type,
    faab_budget: leagueRes.data.faab_budget,
    faab_min_bid: minBid,
    faab_balance: teamSeatRes.data?.faab_balance ?? null,
    waiver_priority: teamSeatRes.data?.waiver_priority ?? null,
    faab_tiebreaker: typeof settings.faab_tiebreaker === 'string' ? settings.faab_tiebreaker : null,
    claims,
  }
  return { status: 200, body: doc as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH …/waivers/[cid] — move one claim to place N in its team's order
// ---------------------------------------------------------------------------

export const reorderClaimInputSchema = z.strictObject({
  /** The claim's new place in its team's pending order (1 = tried first). */
  claim_order: z.number().int().min(1).max(PG_INT_MAX),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type ReorderClaimInput = z.infer<typeof reorderClaimInputSchema>

/** 145's reorder document (`145:891-904`), returned whole. */
export interface ReorderClaimsResult {
  verb: 'waiver_claim_reorder'
  league_id: string
  team_id: string
  team_name: string
  action_id: string
  pending_claims: Array<{ id: string; claim_order: number }>
  no_changes: boolean
  no_changes_why: string | null
  acted_as_commissioner: boolean
  commissioner_action_id: string | null
  system_post: string | null
  notified_user_id: string | null
  reason: string | null
  evaluated_at: string
}

interface ReorderEchoShape {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  pending_claims?: Array<{ id?: unknown }> | null
}

/** Pure: the team's pending ids with `claimId` moved to 1-based `position`.
 *  Exported for its pins. */
export function moveClaim(orderedIds: readonly string[], claimId: string, position: number): string[] {
  const rest = orderedIds.filter((id) => id !== claimId)
  const at = Math.min(Math.max(position, 1), rest.length + 1) - 1
  return [...rest.slice(0, at), claimId, ...rest.slice(at)]
}

export async function reorderClaim(
  supabase: Supabase,
  leagueId: string,
  claimId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = reorderClaimInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { claim_order, action_id, reason } = parsed.data
  const cid = claimId.toLowerCase()

  // The claim, as the CALLER can see it (145's policy: its team's manager or
  // a commissioner). Invisible = the same no-leak 403 145 raises.
  const { data: claim, error: claimError } = await supabase
    .from('waiver_claims')
    .select('id, team_id, status')
    .eq('id', cid)
    .eq('league_id', leagueId)
    .maybeSingle()
  if (claimError) return { status: 500, body: { error: `waiver_claims: ${claimError.message}` } }
  if (!claim) return { status: 403, body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE } }
  if (claim.status !== 'pending') {
    return {
      status: 409,
      body: { error: `Only a pending claim can be moved — this one is ${claim.status}.` },
    }
  }

  const { data: pending, error: pendingError } = await supabase
    .from('waiver_claims')
    .select('id')
    .eq('team_id', claim.team_id)
    .eq('status', 'pending')
    .order('claim_order', { ascending: true })
    .order('id', { ascending: true })
  if (pendingError) return { status: 500, body: { error: `waiver_claims: ${pendingError.message}` } }
  const ids = (pending ?? []).map((row) => row.id)
  if (!ids.includes(cid)) {
    // It was pending a moment ago and is visible to us — a settle/cancel in
    // between. Named, never a silent no-op.
    return { status: 409, body: { error: 'That claim was settled or cancelled a moment ago — refresh your claims.' } }
  }
  if (claim_order > ids.length) {
    return {
      status: 400,
      body: {
        error: {
          formErrors: [],
          fieldErrors: { claim_order: [`This team has ${ids.length} pending claim${ids.length === 1 ? '' : 's'} — pick a place from 1 to ${ids.length}.`] },
        },
      },
    }
  }

  const { data, error } = await supabase.rpc('waiver_claim_reorder', {
    p_league_id: leagueId,
    p_team_id: claim.team_id,
    p_claim_ids: moveClaim(ids, cid, claim_order),
    p_action_id: action_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    return mapInSeasonRpcError(error, WAIVER_CLAIM_FORBIDDEN_MESSAGE)
  }

  // F65(b): this team, this id, and [cid] sits where it was asked to.
  const echo = (data ?? {}) as ReorderEchoShape
  if (
    echo.verb !== 'waiver_claim_reorder' ||
    echo.action_id !== action_id ||
    echo.team_id !== claim.team_id ||
    echo.pending_claims?.[claim_order - 1]?.id !== cid
  ) {
    return { status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH …/waivers/[cid] with { faab_bid, drop_player_id } — edit in place
// (M5 L.D2.9, PROGRESS F417: migration 150's `waiver_claim_edit` — ONE
// transaction, replacing D387(5)'s cancel + resubmit + move-back).
// ---------------------------------------------------------------------------

export const editClaimInputSchema = z.strictObject({
  /** The new bid — 150 SETS it (a priority league refuses anything but $0). */
  faab_bid: wholeDollars,
  /** The new drop — null = no drop. Required so an edit never guesses. */
  drop_player_id: playerId.nullable(),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type EditClaimInput = z.infer<typeof editClaimInputSchema>

/** 150's edit document, returned whole. */
export interface EditClaimResult {
  verb: 'waiver_claim_edit'
  league_id: string
  team_id: string
  team_name: string
  action_id: string
  claim_id: string
  claim: {
    id: string
    add_player_id: string
    drop_player_id: string | null
    faab_bid: number
    claim_order: number
    status: string
    process_at: string | null
    created_at: string
  }
  before: { faab_bid: number; drop_player_id: string | null; claim_order: number }
  add_player_name: string | null
  drop_player_name: string | null
  waiver_type: string
  faab_balance: number | null
  faab_spent: 0
  no_changes: boolean
  no_changes_why: string | null
  pending_claims: Array<{ id: string; claim_order: number }>
  acted_as_commissioner: boolean
  commissioner_action_id: string | null
  system_post: string | null
  notified_user_id: string | null
  reason: string | null
  evaluated_at: string
}

interface EditEchoShape {
  verb?: unknown
  action_id?: unknown
  claim_id?: unknown
  claim?: { faab_bid?: unknown; drop_player_id?: unknown } | null
}

export async function editClaim(
  supabase: Supabase,
  leagueId: string,
  claimId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = editClaimInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { faab_bid, drop_player_id, action_id, reason } = parsed.data
  const cid = claimId.toLowerCase()

  const { data, error } = await supabase.rpc('waiver_claim_edit', {
    p_league_id: leagueId,
    p_claim_id: cid,
    p_bid: faab_bid,
    ...(drop_player_id === null ? {} : { p_drop: drop_player_id }),
    p_action_id: action_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    return mapInSeasonRpcError(error, WAIVER_CLAIM_FORBIDDEN_MESSAGE)
  }

  // F65(b): the replay is verb-, team- and claim-scoped, not argument-scoped —
  // an echo that is not THIS edit is refused, never reported as done.
  const echo = (data ?? {}) as EditEchoShape
  if (
    echo.verb !== 'waiver_claim_edit' ||
    echo.action_id !== action_id ||
    echo.claim_id !== cid ||
    echo.claim?.faab_bid !== faab_bid ||
    (echo.claim?.drop_player_id ?? null) !== drop_player_id
  ) {
    return { status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// DELETE …/waivers/[cid] — cancel
// ---------------------------------------------------------------------------

export const cancelClaimInputSchema = z.strictObject({
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CancelClaimInput = z.infer<typeof cancelClaimInputSchema>

/** 145's cancel document (`145:706-726`), returned whole. */
export interface CancelClaimResult {
  verb: 'waiver_claim_cancel'
  league_id: string
  team_id: string
  team_name: string
  action_id: string
  claim_id: string
  add_player_id: string
  add_player_name: string | null
  status: 'cancelled'
  no_changes: boolean
  no_changes_why: string | null
  pending_claims: Array<{ id: string; claim_order: number }>
  acted_as_commissioner: boolean
  commissioner_action_id: string | null
  system_post: string | null
  notified_user_id: string | null
  reason: string | null
  evaluated_at: string
}

interface CancelEchoShape {
  verb?: unknown
  action_id?: unknown
  claim_id?: unknown
}

export async function cancelClaim(
  supabase: Supabase,
  leagueId: string,
  claimId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = cancelClaimInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { action_id, reason } = parsed.data
  const cid = claimId.toLowerCase()

  const { data, error } = await supabase.rpc('waiver_claim_cancel', {
    p_league_id: leagueId,
    p_claim_id: cid,
    p_action_id: action_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    return mapInSeasonRpcError(error, WAIVER_CLAIM_FORBIDDEN_MESSAGE)
  }

  const echo = (data ?? {}) as CancelEchoShape
  if (echo.verb !== 'waiver_claim_cancel' || echo.action_id !== action_id || echo.claim_id !== cid) {
    return { status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}
