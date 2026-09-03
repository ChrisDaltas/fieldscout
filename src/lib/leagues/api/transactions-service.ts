/**
 * Transactions service — M4 task L.D4.2, `POST /api/leagues/[id]/transactions`
 * (spec §15.3, §13.1; migration 113's `roster_add_drop`; PROGRESS D294/D309;
 * the contract this route inherits is ledger row **F227(f)**).
 *
 * Same D68/D71 layering as `members-service.ts` / `draft-service.ts` (extend
 * the pattern, never fork): the Route Handler is auth + param plumbing, and
 * everything testable lives here over an INJECTED Supabase client so the
 * stack suite (`transactions-api-db.test.ts`) drives the production
 * composition across the real PostgREST wire.
 *
 * **The whole verb is the RPC's** (server-authoritative — CLAUDE.md). This
 * layer computes nothing about rosters, locks, waivers or caps: exclusivity,
 * the E32 game-day lock, roster capacity, waiver state, `fa_hold_hours`, the
 * acquisition caps and the `transactions` row are all 113's, inside one
 * transaction under the league row lock. What this layer owns is the wire
 * shape, the idempotency stamp, and making the refusal READABLE.
 *
 * F227(f), clause by clause:
 *   - send `p_add`/`p_drop`, **either may be null, never both** — refused
 *     here with a field error, and 113 refuses it again with 22023 (the
 *     backstop stays; the edge check is for the field-level message);
 *   - **one `action_id` per submit, reused on retry** — REQUIRED on the wire
 *     (the E2/D68(1) contract). 113 replays by `(league_id, action_id)` and
 *     returns the stored `payload` byte-identically, so a React Query retry
 *     is a replay, never a second move;
 *   - the SQLSTATE mapping is the family's (`inseason-errors.ts`);
 *   - **the refusal text is surfaced verbatim** — never swallowed, never
 *     re-worded into a generic failure. The E32 message names the kickoff,
 *     the datum arm and when the week clears; the waiver message names
 *     `waivers_until`; the cap message names used/cap/week. That is the
 *     whole point of the route existing rather than the UI guessing.
 *
 * **The F65(b) identity guard, applied here (CLAUDE.md's "never let
 * 'nothing happened' mean 'it worked'").** 113's replay branch is kind- and
 * team-scoped (R732) but NOT argument-scoped: a caller who reuses their own
 * `action_id` for a DIFFERENT pair of players gets the ORIGINAL payload back
 * with no error, and answering 200 would report a move the caller never
 * made. The returned payload carries `team_id`/`add_player_id`/
 * `drop_player_id`, so the check costs no extra query — the same shape
 * `draft-service.ts` uses for nominate/bid, minus the seat lookup (113
 * already proved the seat in-body).
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): the `action_id` is minted per submit by the HOOK
 * (`use-transactions.ts`), the D114(5)/D68(1) precedent.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy. 113 raises ONE no-leak 42501 for "nonexistent
 *  league / not a member / not the manager of this team" — including a
 *  COMMISSIONER acting on another team, whose audited arm is M6's
 *  `commissioner_move` (F227(d)) — so this string distinguishes none of
 *  them. */
export const ADD_DROP_FORBIDDEN_MESSAGE =
  'Only this team’s manager can make roster moves.'

/** The 409 for a REUSED action_id that names a different move (the F65(b)
 *  class). An `action_id` is consumed forever, so the copy asks for a fresh
 *  gesture — which mints a fresh id — never for a retry of this submit. */
export const ADD_DROP_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the move you just made. Check the players and try again.'

/**
 * `players.id` is TEXT (the provider's id, e.g. `4034`), not a uuid — so the
 * bound is a shape ceiling, never product law: which ids exist is 113's
 * question and it answers with a named P0001.
 */
const playerId = z.string().trim().min(1).max(64)

export const addDropInputSchema = z
  .strictObject({
    team_id: z.uuid(),
    add_player_id: playerId.nullish(),
    drop_player_id: playerId.nullish(),
    action_id: z.uuid(),
  })
  .refine((body) => Boolean(body.add_player_id) || Boolean(body.drop_player_id), {
    message: 'Name a player to add, a player to drop, or both.',
    path: ['add_player_id'],
  })
export type AddDropInput = z.infer<typeof addDropInputSchema>

/** The slice of 113's result this layer READS. The body handed to the client
 *  is the RPC's payload whole (it is the stored `transactions.payload`), so
 *  nothing here narrows what the UI can render — F227(f) requires
 *  `drop.lineups[]` (`{week, slot}`, `slot: null` = a bench-only touch) and
 *  `caps.used_week_after`/`used_season_after` to reach the surface, and they
 *  do because the payload is passed through untouched. */
interface AddDropResultShape {
  team_id?: unknown
  action_id?: unknown
  add_player_id?: unknown
  drop_player_id?: unknown
}

/**
 * POST /api/leagues/[id]/transactions — add/drop a free agent (§15.3 →
 * `roster_add_drop`).
 *
 * 200 for both a fresh move and a replay of the same submit: the client
 * cannot tell a retried submit from its original, which is the point of the
 * stamp (the draft family's replayed-submit convention).
 */
export async function submitAddDrop(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = addDropInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, add_player_id, drop_player_id, action_id } = parsed.data

  const { data, error } = await supabase.rpc('roster_add_drop', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_action_id: action_id,
    // Optional args: OMIT rather than send null (the members-service rule —
    // the generated Args type cannot express per-arg nullability, and 113
    // defaults both to NULL).
    ...(add_player_id ? { p_add: add_player_id } : {}),
    ...(drop_player_id ? { p_drop: drop_player_id } : {}),
  })
  if (error) {
    return mapInSeasonRpcError(error, ADD_DROP_FORBIDDEN_MESSAGE)
  }

  // F65(b): the payload that came back must be THIS submit — fresh, or the
  // same submit replayed. A mismatch means the action_id was consumed by a
  // different move of this team's, and 113's replay returns it without
  // error; answering 200 would attribute a move the caller never made.
  const result = (data ?? {}) as AddDropResultShape
  if (
    result.team_id !== team_id ||
    result.action_id !== action_id ||
    (result.add_player_id ?? null) !== (add_player_id ?? null) ||
    (result.drop_player_id ?? null) !== (drop_player_id ?? null)
  ) {
    return { status: 409, body: { error: ADD_DROP_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
