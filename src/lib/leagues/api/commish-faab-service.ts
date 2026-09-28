/**
 * Commissioner FAAB edit service — M5 task L.D2.12,
 * `POST /api/leagues/[id]/commish/faab` (spec §15.4 → `commish_edit_faab`,
 * §10.1 "edit any team's FAAB balance", §13.2; migration 147; PROGRESS D385,
 * D387; review nit R1172).
 *
 * `commish-team-service.ts` is the template (copied, not re-derived): thin
 * Route Handler, everything testable here over an INJECTED client. The whole
 * verb is 147's, under the league row lock: the commissioner / co-commissioner
 * gate (one no-leak 42501), the no-op-by-value (no receipt), the retired /
 * seatless refusals by name, the audit row, the §10.3 post and the manager's
 * notification.
 *
 * **The balance bound (R1172).** Any whole number from 0 up — ABOVE the budget
 * is allowed (a repair tool, D385(2)); there is deliberately no lower "sanity"
 * cap. The only ceiling is what the column can hold: Postgres INTEGER, so
 * 2147483648 is a clean 400 here and never a raw out-of-range database error.
 *
 * **F65(b).** 147's replay is keyed on (league, action_id) alone — it does not
 * even compare the team — so a reused id would return the FIRST edit's
 * document as a 200 for an edit nobody made. 147 echoes `team_id` and
 * `requested_balance` for exactly this guard.
 *
 * REASON — OPTIONAL (Q66): `optionalReason`, blank normalised to absent.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'
import { PG_INT_MAX } from './waivers-service'

type Supabase = SupabaseClient<Database>

export const COMMISH_FAAB_FORBIDDEN_MESSAGE = 'Only this league’s commissioner can change a team’s FAAB balance.'

export const COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the balance change you just made. Check the team’s balance and try again.'

export const commishEditFaabInputSchema = z.strictObject({
  team_id: normalizedUuid,
  /** Whole dollars, 0 … INTEGER max (R1172). Above the budget is allowed. */
  balance: z.number().int().min(0).max(PG_INT_MAX),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishEditFaabInput = z.infer<typeof commishEditFaabInputSchema>

/** 147's result document (`147:311-341`), returned whole. */
export interface CommishEditFaabResult {
  league_id: string
  verb: 'commish_edit_faab'
  action_type: 'edit_faab'
  action_id: string
  season: number
  league_status: string
  team_id: string
  team_name: string
  /** The balance AFTER this call. */
  faab_balance: number
  previous_balance: number | null
  requested_balance: number
  delta: number | null
  faab_budget: number | null
  waiver_type: string | null
  /** Pending bids now above the new balance — counted, never touched (D385(5)). */
  pending_bids_above_balance: number
  /** True before the draft starts: a budget change / seat fill / draft reset
   *  can still overwrite this edit — `reseed_why` says which. */
  reseed_can_overwrite: boolean
  reseed_why: string
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT — null exactly when `no_changes`. */
  commissioner_action_id: string | null
  bypassed: string[]
  bypassed_why: string
  reason: string | null
  system_post: string | null
  notified_user_id: string | null
  evaluated_at: string
}

interface EchoShape {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  requested_balance?: unknown
}

export async function commishEditFaab(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = commishEditFaabInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, balance, action_id, reason } = parsed.data

  // 147:366's order: (league, team, balance, reason, action_id).
  const { data, error } = await supabase.rpc('commish_edit_faab', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_balance: balance,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_FAAB_FORBIDDEN_MESSAGE)
  }

  const echo = (data ?? {}) as EchoShape
  if (
    echo.verb !== 'commish_edit_faab' ||
    echo.action_id !== action_id ||
    echo.team_id !== team_id ||
    echo.requested_balance !== balance
  ) {
    return { status: 409, body: { error: COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}
