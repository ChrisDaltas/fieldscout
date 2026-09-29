/**
 * Trades service — M5 task L.D3.6 (spec §13.3, §15.3, §15.4; tasks-M5 §5's
 * route sketch; migrations 148 / 151 / 155 / 156; PROGRESS D386, D410, D415,
 * D416, D417; F450, F451).
 *
 *   POST  /api/leagues/[id]/trades          propose a trade           → trade_propose (148 / 151)
 *   GET   /api/leagues/[id]/trades          the league's trades, with status, reason,
 *                                           review countdown and the vote count (Q77)
 *   PATCH /api/leagues/[id]/trades/[tid]    accept / reject / cancel / counter → trade_respond (151)
 *                                           vote (veto / approve)              → trade_vote (155)
 *   POST  /api/leagues/[id]/commish/trade   approve / veto / force / reverse   → commish_force_or_reverse_trade (156)
 *
 * The D68/D71 layering of the in-season family (`waivers-service.ts` is the
 * template, copied not re-derived): the Route Handlers are auth + param
 * plumbing, and everything testable lives here over an INJECTED client so the
 * stack suites (`trades-api-db.test.ts`, `commish-trade-api-db.test.ts`)
 * drive the production composition across the real PostgREST wire.
 *
 * **The whole verb is the RPC's** (server-authoritative — CLAUDE.md). Whose
 * move an op is, the roster fit (E36), exclusivity, the FAAB legs, the
 * deadline (Q76), review, the game-day lock (Q75), who votes (Q77) and what
 * the commissioner may override (D416) are all decided in the database,
 * under the league row lock. This layer owns the wire shape, the idempotency
 * stamp, the F65(b) identity guard and making a refusal readable
 * (`inseason-errors.ts`: 42501→403, P0001→409 verbatim, 22023→400).
 *
 * **F65(b) — every trade verb's replay is scoped, but none is ARGUMENT-
 * scoped.** 148's propose replays on (verb, team); 151's respond on (verb,
 * team, trade, op); 155's vote on (verb, team, trade, vote); 156's override
 * on (trade, op). A reused `action_id` naming different legs / drops / a
 * different counter replays the FIRST request's document with no error, so
 * each write compares the echo with what was sent and answers 409 on a
 * mismatch. Uuids are lower-cased at the schema (R768, `inseason-ids.ts`).
 *
 * **Deploy before push (the hosted database is at 134; trades are 148+).**
 * Against a database without the trade tables / functions PostgREST answers
 * PGRST205 (no table) or PGRST202 (no function); every call here recognises
 * that answer for the trade objects BY NAME and returns a 503 with a named
 * sentence — never a raw 500, never an empty list that reads as "no trades".
 *
 * **Visibility.** Trades are not blind (§12.11 — only waiver bids are): every
 * member reads every trade. The GET still asserts membership FIRST (R807), so
 * a non-member is refused by name, never answered with RLS's empty list. The
 * vote count is `trade_vote_tally`'s (155): the count, the number and the
 * caller's OWN vote — never who voted.
 *
 * Time: the GET's countdowns are computed at the caller-supplied `now`
 * (the route passes `systemTime.now()` — the TimeProvider rule); no Date or
 * random read anywhere in this file. Every `action_id` is minted per gesture
 * by the HOOK.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError, type RpcErrorLike } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'
import { PG_INT_MAX } from './waivers-service'

type Supabase = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** 148's one no-leak 42501 for propose: no such league / not a member / not
 *  this team's manager and not the commissioner. */
export const TRADE_PROPOSE_FORBIDDEN_MESSAGE =
  'Only this team’s manager (or the league’s commissioner) can offer a trade for it.'

/** 151's one no-leak 42501 for respond: no such league / not a member / a
 *  member who is not one of the two teams (and not the commissioner) / no
 *  such trade. The OTHER party asking for the wrong move is a 409 by name. */
export const TRADE_RESPOND_FORBIDDEN_MESSAGE =
  'Only the two teams in this trade (or the league’s commissioner) can answer it.'

/** 155's 42501 for a vote: not a member of this league (a party, a member
 *  with no team and a retired team are refused BY NAME — 409). */
export const TRADE_VOTE_FORBIDDEN_MESSAGE = 'Only managers in this league can vote on its trades.'

/** 156's one no-leak 42501: no such league / not a member / a manager —
 *  even one of the trade's own teams. */
export const COMMISH_TRADE_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can approve, veto, force or reverse a trade.'

/** The 409 for a REUSED action_id naming a different request (F65(b)). */
export const TRADE_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the trade move you just made. Check the trade and try again.'

/** The deploy-before-push answer (503): the database has no trade objects. */
export const TRADES_UNAVAILABLE_MESSAGE =
  'Trades aren’t available yet — the league database hasn’t been updated for trades. Try again after the next update.'

// ---------------------------------------------------------------------------
// Deploy-before-push: a missing trade table / function is a named 503
// ---------------------------------------------------------------------------

/** The trade objects this service reads or calls (148 / 155 / 156). */
export const TRADE_SCHEMA_OBJECTS = [
  'trades',
  'trade_items',
  'trade_drops',
  'trade_propose',
  'trade_respond',
  'trade_vote',
  'trade_vote_tally',
  'commish_force_or_reverse_trade',
] as const

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `error` is the database saying one of `names` does not EXIST —
 * PostgREST's schema-cache answers (PGRST205 "Could not find the table
 * 'public.x'", PGRST202 "Could not find the function public.x(…)" — both
 * measured on the local stack 2026-09-28) or Postgres's own (42P01 relation /
 * 42883 function). Anchored on the object's NAME so an unrelated missing
 * object is never mistaken for "trades are not deployed" (R1222's lesson:
 * anchor the match). Exported for its pins and the stack cell.
 */
export function isMissingSchemaObject(error: RpcErrorLike | null | undefined, names: readonly string[]): boolean {
  if (!error) return false
  if (!['PGRST205', 'PGRST202', '42P01', '42883'].includes(error.code ?? '')) return false
  const message = error.message ?? ''
  return names.some((name) => new RegExp(`(\\bpublic\\.${escapeRegExp(name)}\\b|"${escapeRegExp(name)}")`).test(message))
}

function unavailable(): ServiceResult {
  return { status: 503, body: { error: TRADES_UNAVAILABLE_MESSAGE } }
}

function rpcFailure(error: RpcErrorLike, forbiddenMessage: string): ServiceResult {
  if (isMissingSchemaObject(error, TRADE_SCHEMA_OBJECTS)) return unavailable()
  return mapInSeasonRpcError(error, forbiddenMessage)
}

// ---------------------------------------------------------------------------
// Shared wire shapes
// ---------------------------------------------------------------------------

/** `players.id` is TEXT (the provider's id) — a shape ceiling, not product law. */
const playerId = z.string().trim().min(1).max(64)

/** One leg: a player OR a whole-dollar FAAB amount, from one of the two teams
 *  (148's leg shape — `to_team_id` is implied: the other team). */
export const tradeLegSchema = z.union([
  z.strictObject({ player_id: playerId, from_team_id: normalizedUuid }),
  z.strictObject({ faab_amount: z.number().int().min(1).max(PG_INT_MAX), from_team_id: normalizedUuid }),
])
export type TradeLegInput = z.infer<typeof tradeLegSchema>

const legs = z.array(tradeLegSchema).min(1, 'A trade moves at least one player or some FAAB.').max(64)
/** E36: the players this team drops so its roster fits after the trade. */
const drops = z.array(playerId).max(64)
/** The optional note (148: trimmed, ≤ 500; blank = none). */
const note = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === '' ? undefined : value))
  .optional()

interface LegEcho {
  player_id?: unknown
  faab_amount?: unknown
  from_team_id?: unknown
}
interface DropEcho {
  team_id?: unknown
  player_id?: unknown
}
interface TradeEcho {
  id?: unknown
  proposer_team_id?: unknown
  recipient_team_id?: unknown
  items?: LegEcho[] | null
  drops?: DropEcho[] | null
}

/** A leg as one comparable string — order-free comparison of sent vs echoed. */
function legKey(leg: LegEcho): string {
  return leg.player_id != null ? `${String(leg.from_team_id)}|p:${String(leg.player_id)}` : `${String(leg.from_team_id)}|f:${String(leg.faab_amount)}`
}

function sameLegs(sent: readonly TradeLegInput[], echoed: readonly LegEcho[] | null | undefined): boolean {
  const a = sent.map((leg) => legKey(leg)).sort()
  const b = (echoed ?? []).map(legKey).sort()
  return a.length === b.length && a.every((key, i) => key === b[i])
}

function sameDrops(sent: readonly string[] | undefined, echoed: readonly DropEcho[] | null | undefined, teamId: unknown): boolean {
  const a = [...(sent ?? [])].sort()
  const b = (echoed ?? [])
    .filter((d) => d.team_id === teamId)
    .map((d) => String(d.player_id))
    .sort()
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function badRequest(error: z.ZodError): ServiceResult {
  return { status: 400, body: { error: z.flattenError(error) as unknown as Json } }
}

function reused(): ServiceResult {
  return { status: 409, body: { error: TRADE_ACTION_ID_REUSED_MESSAGE } }
}

// ---------------------------------------------------------------------------
// POST …/trades — propose
// ---------------------------------------------------------------------------

export const proposeTradeInputSchema = z
  .strictObject({
    /** The team making the offer — the caller's own, or any team for the
     *  commissioner (TD5). */
    from_team_id: normalizedUuid,
    to_team_id: normalizedUuid,
    items: legs,
    /** The proposer's drops (E36) — the receiving team names its own at
     *  acceptance. */
    drops: drops.optional(),
    note,
    action_id: normalizedUuid,
    /** Stored only on the commissioner arm (Q66: optional). */
    reason: optionalReason,
  })
  .refine((body) => body.from_team_id !== body.to_team_id, {
    message: 'A trade is between two different teams.',
    path: ['to_team_id'],
  })
export type ProposeTradeInput = z.infer<typeof proposeTradeInputSchema>

interface ProposeEcho {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  trade?: TradeEcho | null
}

export async function proposeTrade(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = proposeTradeInputSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error)
  const { from_team_id, to_team_id, items, drops: proposerDrops, note: offerNote, action_id, reason } = parsed.data

  // Optional args are OMITTED rather than sent as null (148 defaults each).
  const { data, error } = await supabase.rpc('trade_propose', {
    p_league_id: leagueId,
    p_from_team_id: from_team_id,
    p_to_team_id: to_team_id,
    p_items: items as unknown as Json,
    ...(proposerDrops && proposerDrops.length > 0 ? { p_drops: proposerDrops } : {}),
    ...(offerNote === undefined ? {} : { p_note: offerNote }),
    p_action_id: action_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) return rpcFailure(error, TRADE_PROPOSE_FORBIDDEN_MESSAGE)

  // F65(b): 148's replay is (verb, team)-scoped — the offer that came back
  // must be THIS one: the same two teams, the same legs, the same drops.
  const echo = (data ?? {}) as ProposeEcho
  if (
    echo.verb !== 'trade_propose' ||
    echo.action_id !== action_id ||
    echo.team_id !== from_team_id ||
    echo.trade?.proposer_team_id !== from_team_id ||
    echo.trade?.recipient_team_id !== to_team_id ||
    !sameLegs(items, echo.trade?.items) ||
    !sameDrops(proposerDrops, echo.trade?.drops, from_team_id)
  ) {
    return reused()
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// PATCH …/trades/[tid] — accept / reject / cancel / counter / vote
// ---------------------------------------------------------------------------

export const tradeActionInputSchema = z.discriminatedUnion('op', [
  /** The receiving team, naming the drops its roster needs (E36). */
  z.strictObject({ op: z.literal('accept'), drops: drops.optional(), action_id: normalizedUuid, reason: optionalReason }),
  /** The receiving team. */
  z.strictObject({ op: z.literal('reject'), action_id: normalizedUuid, reason: optionalReason }),
  /** The proposing team. */
  z.strictObject({ op: z.literal('cancel'), action_id: normalizedUuid, reason: optionalReason }),
  /** The receiving team: the offer is rejected and a new one goes the other
   *  way — `items` are the counter-offer's legs, `drops` the counter-
   *  proposer's own. */
  z.strictObject({ op: z.literal('counter'), items: legs, drops: drops.optional(), note, action_id: normalizedUuid, reason: optionalReason }),
  /** A league-vote review (Q77): the caller votes for his own team — no
   *  team argument and no commissioner arm (D415(1)). */
  z.strictObject({ op: z.literal('vote'), vote: z.enum(['veto', 'approve']), action_id: normalizedUuid }),
])
export type TradeActionInput = z.infer<typeof tradeActionInputSchema>

interface RespondEcho {
  verb?: unknown
  op?: unknown
  action_id?: unknown
  trade_id?: unknown
  trade?: TradeEcho | null
  counter_trade?: TradeEcho | null
}

interface VoteEcho {
  op?: unknown
  trade_id?: unknown
  vote?: unknown
}

export async function actOnTrade(supabase: Supabase, leagueId: string, tradeId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = tradeActionInputSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error)
  const body = parsed.data
  const tid = tradeId.toLowerCase()

  if (body.op === 'vote') {
    const { data, error } = await supabase.rpc('trade_vote', {
      p_league_id: leagueId,
      p_trade_id: tid,
      p_vote: body.vote,
      p_action_id: body.action_id,
    })
    if (error) return rpcFailure(error, TRADE_VOTE_FORBIDDEN_MESSAGE)
    // 155's replay is vote-scoped (a different vote under the same id is its
    // own by-name P0001); the echo is still checked, never assumed.
    const echo = (data ?? {}) as VoteEcho
    if (echo.op !== 'vote' || echo.trade_id !== tid || echo.vote !== body.vote) return reused()
    return { status: 200, body: data as unknown as Json }
  }

  const { data, error } = await supabase.rpc('trade_respond', {
    p_league_id: leagueId,
    p_trade_id: tid,
    p_op: body.op,
    ...((body.op === 'accept' || body.op === 'counter') && body.drops && body.drops.length > 0 ? { p_drops: body.drops } : {}),
    ...(body.op === 'counter' ? { p_items: body.items as unknown as Json } : {}),
    ...(body.op === 'counter' && body.note !== undefined ? { p_note: body.note } : {}),
    p_action_id: body.action_id,
    ...(body.reason === undefined ? {} : { p_reason: body.reason }),
  })
  if (error) return rpcFailure(error, TRADE_RESPOND_FORBIDDEN_MESSAGE)

  // F65(b): 151's replay is (verb, team, trade, op)-scoped — a reused id
  // with different drops (accept) or a different counter-offer replays the
  // first answer, so those are compared too.
  const echo = (data ?? {}) as RespondEcho
  if (echo.verb !== 'trade_respond' || echo.op !== body.op || echo.action_id !== body.action_id || echo.trade_id !== tid) {
    return reused()
  }
  if (body.op === 'accept' && !sameDrops(body.drops, echo.trade?.drops, echo.trade?.recipient_team_id)) {
    return reused()
  }
  if (
    body.op === 'counter' &&
    (!echo.counter_trade ||
      !sameLegs(body.items, echo.counter_trade.items) ||
      !sameDrops(body.drops, echo.counter_trade.drops, echo.counter_trade.proposer_team_id))
  ) {
    return reused()
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// POST …/commish/trade — approve / veto / force / reverse (F451)
// ---------------------------------------------------------------------------

export const COMMISH_TRADE_OPS = ['approve', 'veto', 'force', 'reverse'] as const
export type CommishTradeOp = (typeof COMMISH_TRADE_OPS)[number]

export const commishTradeInputSchema = z.strictObject({
  trade_id: normalizedUuid,
  op: z.enum(COMMISH_TRADE_OPS),
  action_id: normalizedUuid,
  /** OPTIONAL (Q66); blank normalised to absent. */
  reason: optionalReason,
})
export type CommishTradeInput = z.infer<typeof commishTradeInputSchema>

/** 156's result document (`156:1689-1718` + the R1228 `score_*` keys),
 *  returned whole. */
export interface CommishTradeResult {
  league_id: string
  verb: 'commish_force_or_reverse_trade'
  op: CommishTradeOp
  action_type: string
  action_id: string
  trade_id: string
  season: number
  trade_review: string
  status_before: string
  status: string
  outcome: 'approved' | 'approved_deferred' | 'vetoed' | 'forced' | 'reversed' | 'no_change'
  trade: Record<string, unknown>
  summary: string
  accepted_for_team_id: string | null
  execution: Record<string, unknown> | null
  reversal: Record<string, unknown> | null
  transaction_id: string | null
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT — null exactly when `no_changes`. */
  commissioner_action_id: string | null
  /** The timing / review rules stood outside (`review_period`,
   *  `league_vote`, `trade_deadline`, `game_day_lock:<player>`). */
  bypassed: string[]
  bypassed_why: string
  reason: string | null
  system_post: string | null
  notified_user_ids: string[]
  evaluated_at: string
  score_week: number | null
  score_stale: boolean
}

interface CommishEcho {
  verb?: unknown
  op?: unknown
  action_id?: unknown
  trade_id?: unknown
}

export async function commishTrade(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = commishTradeInputSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error)
  const { trade_id, op, action_id, reason } = parsed.data

  // 156:1742's order: (league, trade, op, reason, action_id).
  const { data, error } = await supabase.rpc('commish_force_or_reverse_trade', {
    p_league_id: leagueId,
    p_trade_id: trade_id,
    p_op: op,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) return rpcFailure(error, COMMISH_TRADE_FORBIDDEN_MESSAGE)

  // F451 / F65(b): the echo must be THIS op on THIS trade under THIS id.
  const echo = (data ?? {}) as CommishEcho
  if (echo.verb !== 'commish_force_or_reverse_trade' || echo.op !== op || echo.action_id !== action_id || echo.trade_id !== trade_id) {
    return reused()
  }
  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// GET …/trades — the league's trades
// ---------------------------------------------------------------------------

/** The statuses a trade is still in flight in (148's `trades_resolved_shape`). */
export const IN_FLIGHT_TRADE_STATUSES = ['proposed', 'accepted', 'in_review'] as const
export const CLOSED_TRADE_STATUSES = ['rejected', 'cancelled', 'vetoed', 'complete', 'reversed', 'invalid', 'expired'] as const
export type TradeStatus = (typeof IN_FLIGHT_TRADE_STATUSES)[number] | (typeof CLOSED_TRADE_STATUSES)[number]

export const readTradesQuerySchema = z.strictObject({
  /** `open` = in flight (the trade center's pending tab), `closed` = history,
   *  `all` (default). */
  status: z.enum(['open', 'closed', 'all']).default('all'),
  /** Only trades this team is in (either side). */
  team_id: z.uuid().optional(),
})

export interface TradePlayer {
  player_id: string
  full_name: string | null
  position: string | null
  nfl_team: string | null
}

export interface TradeTeamRef {
  team_id: string
  name: string | null
}

/** `trade_vote_tally` (155:466-527), passed through: the count, never who. */
export interface TradeVoteTally {
  trade_id: string
  review: string
  status: string
  veto_votes: number
  eligible_voters: number
  /** The league's `trade_veto_votes`. */
  setting: number
  /** The number that vetoes — the setting capped at the managers who can
   *  vote (F430); `capped` says the cap applied (F450: say so in words). */
  veto_number: number
  capped: boolean
  voting_open: boolean
  closes_at: string | null
  /** The CALLER's own vote — never anyone else's. */
  my_vote: 'veto' | 'approve' | null
  can_vote: boolean
  cannot_vote_because: 'voting_closed' | 'no_team' | 'party' | 'retired' | null
  evaluated_at: string
}

export interface TradeView {
  id: string
  status: TradeStatus
  /** Why it left flight — "rejected by …", "countered by …", E37's sentence,
   *  the veto's count (C74). Null while in flight / complete. */
  status_reason: string | null
  in_flight: boolean
  proposer: TradeTeamRef
  recipient: TradeTeamRef
  note: string | null
  countered_from: string | null
  created_at: string
  accepted_at: string | null
  resolved_at: string | null
  items: Array<{ from_team_id: string; to_team_id: string; player: TradePlayer | null; faab_amount: number | null }>
  drops: Array<{ team_id: string; player: TradePlayer }>
  /** `in_review` only: the review's mode and its end (§13.3; the tick
   *  approves AT `ends_at` unless it is vetoed first). */
  review: { mode: string; ends_at: string | null; ms_remaining: number | null } | null
  /** `accepted` and waiting for the week's last game (Q75 / E35):
   *  `until` null = the week's end is not recorded yet (151's `infinity`). */
  deferred: { until: string | null; ms_remaining: number | null } | null
  /** A league-vote trade in review: `trade_vote_tally`'s document. */
  tally: TradeVoteTally | null
}

export interface TradesDocument {
  league_id: string
  status: 'open' | 'closed' | 'all'
  team_id: string | null
  /** The caller: his team (null when he manages none) and whether he may
   *  use the commissioner's tools — for the UI's buttons only; the server
   *  decides every move. */
  viewer: { team_id: string | null; is_commissioner: boolean }
  /** The league's trade settings (§7.3.5), as the verbs read them. */
  settings: {
    trade_review: string
    trade_review_period_hours: number
    trade_deadline_week: number | null
    trade_lock_behavior: string
    allow_faab_in_trades: boolean
    allow_future_considerations: boolean
  }
  /** The instant every `ms_remaining` was computed at (the TimeProvider's
   *  now) — a countdown renders from the server's clock, never the client's
   *  (§9.3). */
  evaluated_at: string
  /** Newest first. */
  trades: TradeView[]
}

const TRADE_COLUMNS =
  'id, status, status_reason, proposer_team_id, recipient_team_id, note, countered_from, created_at, accepted_at, resolved_at, review_deadline, execute_after, trade_items(from_team_id, to_team_id, player_id, faab_amount), trade_drops(team_id, player_id)'

interface TradeRow {
  id: string
  status: string
  status_reason: string | null
  proposer_team_id: string
  recipient_team_id: string
  note: string | null
  countered_from: string | null
  created_at: string
  accepted_at: string | null
  resolved_at: string | null
  review_deadline: string | null
  execute_after: string | null
  trade_items: Array<{ from_team_id: string; to_team_id: string; player_id: string | null; faab_amount: number | null }> | null
  trade_drops: Array<{ team_id: string; player_id: string }> | null
}

/** Milliseconds from `now` to `instant`, never negative; null for an
 *  instant that is not a finite time (`infinity`, garbage). Exported for its
 *  pins. */
export function msUntil(instant: string | null, now: Date): number | null {
  if (instant === null) return null
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - now.getTime())
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanSetting(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key]
  return typeof value === 'boolean' ? value : fallback
}

export async function readTrades(
  supabase: Supabase,
  leagueId: string,
  userId: string,
  rawQuery: unknown,
  now: Date,
): Promise<ServiceResult> {
  const parsed = readTradesQuerySchema.safeParse(rawQuery ?? {})
  if (!parsed.success) return badRequest(parsed.error)
  const { status } = parsed.data
  const teamFilter = parsed.data.team_id?.toLowerCase() ?? null

  // The family's gate FIRST (R807): a non-member is refused by name, never
  // handed an empty list.
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const [leagueRes, seatRes, commishRes, teamsRes] = await Promise.all([
    supabase.from('leagues').select('trade_review, trade_deadline_week, settings').eq('id', leagueId).is('deleted_at', null).maybeSingle(),
    supabase.from('league_members').select('team_id').eq('league_id', leagueId).eq('user_id', userId).maybeSingle(),
    supabase.rpc('is_league_commish', { p_league_id: leagueId }),
    supabase.from('teams').select('id, name').eq('league_id', leagueId),
  ])
  if (leagueRes.error) return { status: 500, body: { error: `leagues: ${leagueRes.error.message}` } }
  if (seatRes.error) return { status: 500, body: { error: `league_members: ${seatRes.error.message}` } }
  if (commishRes.error) return { status: 500, body: { error: `is_league_commish: ${commishRes.error.message}` } }
  if (teamsRes.error) return { status: 500, body: { error: `teams: ${teamsRes.error.message}` } }
  if (!leagueRes.data) {
    return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
  }
  const teamNames = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]))
  if (teamFilter !== null && !teamNames.has(teamFilter)) {
    return { status: 404, body: { error: 'That team isn’t part of this league.' } }
  }

  let tradesQuery = supabase
    .from('trades')
    .select(TRADE_COLUMNS)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (status === 'open') tradesQuery = tradesQuery.in('status', [...IN_FLIGHT_TRADE_STATUSES])
  if (status === 'closed') tradesQuery = tradesQuery.in('status', [...CLOSED_TRADE_STATUSES])
  if (teamFilter !== null) tradesQuery = tradesQuery.or(`proposer_team_id.eq.${teamFilter},recipient_team_id.eq.${teamFilter}`)
  const { data: tradeData, error: tradesError } = await tradesQuery
  if (tradesError) {
    if (isMissingSchemaObject(tradesError, TRADE_SCHEMA_OBJECTS)) return unavailable()
    return { status: 500, body: { error: `trades: ${tradesError.message}` } }
  }
  const rows = (tradeData ?? []) as unknown as TradeRow[]
  const capped = assertBelowPostgrestCap(rows, 'trades')
  if (capped) return capped

  const playerIds = [
    ...new Set(rows.flatMap((r) => [...(r.trade_items ?? []).flatMap((i) => (i.player_id ? [i.player_id] : [])), ...(r.trade_drops ?? []).map((d) => d.player_id)])),
  ]
  const playersById = new Map<string, { full_name: string; position: string; team: string | null }>()
  if (playerIds.length > 0) {
    const { data: players, error } = await supabase.from('players').select('id, full_name, position, team').in('id', playerIds)
    if (error) return { status: 500, body: { error: `players: ${error.message}` } }
    for (const p of players ?? []) playersById.set(p.id, p)
  }
  const player = (id: string): TradePlayer => {
    const p = playersById.get(id)
    return { player_id: id, full_name: p?.full_name ?? null, position: p?.position ?? null, nfl_team: p?.team ?? null }
  }

  const review = leagueRes.data.trade_review ?? 'commissioner'
  // The vote count (Q77) for every league-vote trade in review — the
  // count, the number and the caller's own vote; never who voted.
  const voting = review === 'league_vote' ? rows.filter((r) => r.status === 'in_review') : []
  const tallies = new Map<string, TradeVoteTally>()
  const tallyResults = await Promise.all(voting.map((r) => supabase.rpc('trade_vote_tally', { p_trade_id: r.id })))
  for (const [i, res] of tallyResults.entries()) {
    if (res.error) {
      if (isMissingSchemaObject(res.error, TRADE_SCHEMA_OBJECTS)) return unavailable()
      return { status: 500, body: { error: `trade_vote_tally: ${res.error.message}` } }
    }
    tallies.set(voting[i].id, res.data as unknown as TradeVoteTally)
  }

  const trades: TradeView[] = rows.map((r) => {
    const inFlight = (IN_FLIGHT_TRADE_STATUSES as readonly string[]).includes(r.status)
    // Legs in 151's view order: the proposer's first, players before FAAB.
    const items = [...(r.trade_items ?? [])].sort(
      (a, b) =>
        Number(a.from_team_id !== r.proposer_team_id) - Number(b.from_team_id !== r.proposer_team_id) ||
        Number(a.faab_amount !== null) - Number(b.faab_amount !== null) ||
        String(a.player_id).localeCompare(String(b.player_id)),
    )
    const dropRows = [...(r.trade_drops ?? [])].sort(
      (a, b) => Number(a.team_id !== r.proposer_team_id) - Number(b.team_id !== r.proposer_team_id) || a.player_id.localeCompare(b.player_id),
    )
    const deferredUntil = r.status === 'accepted' && r.execute_after !== null ? r.execute_after : null
    return {
      id: r.id,
      status: r.status as TradeStatus,
      status_reason: r.status_reason,
      in_flight: inFlight,
      proposer: { team_id: r.proposer_team_id, name: teamNames.get(r.proposer_team_id) ?? null },
      recipient: { team_id: r.recipient_team_id, name: teamNames.get(r.recipient_team_id) ?? null },
      note: r.note,
      countered_from: r.countered_from,
      created_at: r.created_at,
      accepted_at: r.accepted_at,
      resolved_at: r.resolved_at,
      items: items.map((i) => ({
        from_team_id: i.from_team_id,
        to_team_id: i.to_team_id,
        player: i.player_id ? player(i.player_id) : null,
        faab_amount: i.faab_amount,
      })),
      drops: dropRows.map((d) => ({ team_id: d.team_id, player: player(d.player_id) })),
      review: r.status === 'in_review' ? { mode: review, ends_at: r.review_deadline, ms_remaining: msUntil(r.review_deadline, now) } : null,
      deferred:
        deferredUntil === null
          ? null
          : Number.isFinite(Date.parse(deferredUntil))
            ? { until: deferredUntil, ms_remaining: msUntil(deferredUntil, now) }
            : { until: null, ms_remaining: null },
      tally: tallies.get(r.id) ?? null,
    }
  })

  const settings = (leagueRes.data.settings ?? {}) as Record<string, unknown>
  const lockBehavior = settings.trade_lock_behavior
  const doc: TradesDocument = {
    league_id: leagueId,
    status,
    team_id: teamFilter,
    viewer: { team_id: seatRes.data?.team_id ?? null, is_commissioner: commishRes.data === true },
    settings: {
      trade_review: review,
      // 151's own fallbacks (`COALESCE(…, 24)`, `defer`) — the catalog's defaults.
      trade_review_period_hours: numberSetting(settings, 'trade_review_period_hours', 24),
      trade_deadline_week: leagueRes.data.trade_deadline_week,
      trade_lock_behavior: typeof lockBehavior === 'string' ? lockBehavior : 'defer',
      allow_faab_in_trades: booleanSetting(settings, 'allow_faab_in_trades', false),
      allow_future_considerations: booleanSetting(settings, 'allow_future_considerations', false),
    },
    evaluated_at: now.toISOString(),
    trades,
  }
  return { status: 200, body: doc as unknown as Json }
}

// ---------------------------------------------------------------------------
// L.D3.12 — the trade deadline and the legality preview (migration 162;
// PROGRESS D426, F452, F462). Chris 2026-09-29: "there is no such thing as
// trade that isn't legal" — the trade screen PREVENTS an offer the league
// would refuse, so it asks the database BEFORE the manager sends / accepts.
//
//   GET  /api/leagues/[id]/trades/deadline   → trade_deadline (162)
//   POST /api/leagues/[id]/trades/preview    → trade_preview  (162)
//
// Both are READS over the verbs' own internals (`trade_deadline_internal`,
// `trade_check_internal`) — nothing about legality is decided here. Deploy
// before push: until 162 is pushed both functions are missing, and the named
// 503 below tells the screen to fall back to send-and-see (D419's shape).
// ---------------------------------------------------------------------------

/** 162's two doors — a missing one means "not pushed yet", never a crash. */
export const TRADE_CHECK_OBJECTS = ['trade_deadline', 'trade_preview'] as const

/** The deploy-before-push answer for the two reads (503). */
export const TRADE_CHECKS_UNAVAILABLE_MESSAGE =
  'The trade deadline and the offer check aren’t available yet — the league database hasn’t been updated. Offers are still checked when you send them.'

/** 162's one no-leak 42501 for both reads: no league / a deleted league /
 *  not a member. */
export const TRADE_CHECKS_FORBIDDEN_MESSAGE = 'Only members of this league can see its trade deadline and check offers.'

/** `trade_deadline` (162) — 151's deadline document plus `passed` at the
 *  database's now() (the clock the verbs refuse by). */
export interface TradeDeadlineView {
  league_id: string
  /** `trade_deadline_week` — null = no deadline. */
  deadline_week: number | null
  /** Week N+1's start; null = no deadline, or it falls after the calendar. */
  deadline_at: string | null
  why: 'no_deadline' | 'after_last_calendar_week' | 'next_week_starts'
  /** The instant in the league's zone, the verbs' own label. */
  label: string | null
  passed: boolean
  ms_remaining: number | null
  evaluated_at: string
}

/** One side's roster after the trade — `trade_check_internal`'s facts. */
export interface TradeRosterFacts {
  team_id: string
  count_before: number
  players_out: number
  players_in: number
  drops: number
  count_after: number
  roster_size: number
  /** How many MORE players this team must drop (E36) — 0 = it fits. */
  must_drop: number
  /** Whether the verb would enforce this side now (the receiving team's side
   *  of an offer is only reported — it names its drops when it accepts). */
  enforced: boolean
}

/** `trade_preview` (162). */
export interface TradePreview {
  mode: 'offer' | 'accept'
  league_id: string
  trade_id: string | null
  proposer_team_id: string
  recipient_team_id: string
  /** The verb would take it as it stands. */
  ok: boolean
  league_status: string
  in_season: boolean
  deadline: TradeDeadlineView
  /** The first refusal the validator would raise (its own sentence). */
  refusal: string | null
  rosters: { proposer: TradeRosterFacts; recipient: TradeRosterFacts } | null
  evaluated_at: string
}

/** Each door's parameters as 162 defines them — what this file sends. */
export const TRADE_CHECK_DOORS: Readonly<Record<string, readonly string[]>> = {
  trade_deadline: ['p_league_id'],
  trade_preview: ['p_league_id', 'p_trade_id', 'p_from_team_id', 'p_to_team_id', 'p_items', 'p_drops'],
}

/**
 * R1282: true ONLY when the database has no such door — 162 not pushed yet —
 * never for a call the door exists for but does not match (argument drift).
 * PostgREST answers both with PGRST202 (measured on the local stack
 * 2026-09-29), so a PGRST202 counts as "not pushed" only when (a) its hint
 * does not offer the SAME function under another signature ("Perhaps you
 * meant to call the function public.trade_deadline(p_league_id)" — the door
 * is there) and (b) every argument it names is one of the door's own (a
 * `p_bogus` means the CALL drifted — the hint is not always given, measured:
 * `trade_preview(p_bogus, p_league_id)` came back with `hint: null`).
 * Anything else is a loud 500, never the quiet fallback.
 */
export function isDoorNotPushed(
  error: (RpcErrorLike & { hint?: string | null }) | null | undefined,
  doors: Readonly<Record<string, readonly string[]>> = TRADE_CHECK_DOORS,
): boolean {
  if (!error) return false
  for (const [name, params] of Object.entries(doors)) {
    if (!isMissingSchemaObject(error, [name])) continue
    if (error.code !== 'PGRST202') return true
    if ((error.hint ?? '').includes(`public.${name}(`)) return false
    const args = new RegExp(`public\\.${escapeRegExp(name)}\\(([^)]*)\\)`).exec(error.message ?? '')
    const named = (args?.[1] ?? '').split(',').map((a) => a.trim()).filter(Boolean)
    return named.every((a) => params.includes(a))
  }
  return false
}

function checksFailure(error: RpcErrorLike & { hint?: string | null }): ServiceResult {
  if (isDoorNotPushed(error)) {
    return { status: 503, body: { error: TRADE_CHECKS_UNAVAILABLE_MESSAGE } }
  }
  return mapInSeasonRpcError(error, TRADE_CHECKS_FORBIDDEN_MESSAGE)
}

export async function readTradeDeadline(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('trade_deadline', { p_league_id: leagueId })
  if (error) return checksFailure(error)
  if (data === null || typeof data !== 'object') {
    return { status: 500, body: { error: 'trade_deadline: the database answered no deadline document' } }
  }
  return { status: 200, body: data as unknown as Json }
}

/** The preview's two arms (162): ACCEPT names the offer only (its legs are
 *  the stored ones) plus the receiving team's drops; OFFER names both teams,
 *  the legs and the offering team's drops. */
export const tradePreviewInputSchema = z.union([
  z.strictObject({ trade_id: normalizedUuid, drops: drops.optional() }),
  z
    .strictObject({ from_team_id: normalizedUuid, to_team_id: normalizedUuid, items: legs, drops: drops.optional() })
    .refine((body) => body.from_team_id !== body.to_team_id, {
      message: 'A trade is between two different teams.',
      path: ['to_team_id'],
    }),
])
export type TradePreviewInput = z.infer<typeof tradePreviewInputSchema>

export async function previewTrade(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = tradePreviewInputSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error)
  const body = parsed.data
  const dropsArg = body.drops && body.drops.length > 0 ? { p_drops: body.drops } : {}
  const { data, error } = await supabase.rpc(
    'trade_preview',
    'trade_id' in body
      ? { p_league_id: leagueId, p_trade_id: body.trade_id, ...dropsArg }
      : { p_league_id: leagueId, p_from_team_id: body.from_team_id, p_to_team_id: body.to_team_id, p_items: body.items as unknown as Json, ...dropsArg },
  )
  if (error) return checksFailure(error)
  if (data === null || typeof data !== 'object') {
    return { status: 500, body: { error: 'trade_preview: the database answered no preview document' } }
  }
  return { status: 200, body: data as unknown as Json }
}
