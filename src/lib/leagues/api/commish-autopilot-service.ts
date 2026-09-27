/**
 * Commissioner autopilot switch service — M6A task L.E1.22,
 * `POST /api/leagues/[id]/commish/autopilot` (spec §7.2.1(c) / §10.1
 * Membership, v2.16.42's Q63 ruling → `commish_set_autopilot`, migration 139;
 * §10.3; PROGRESS Q63, D351 (the route doctrine, copied), D376).
 *
 * `commish-team-service.ts` is the template (D351: copied, not re-derived):
 * a thin Route Handler, everything testable here over an INJECTED client
 * (D68/D71). The whole verb is the RPC's (server-authoritative — CLAUDE.md):
 * the seat predicate (ON only for an unmanaged seat — D339), the no-op by
 * value, the audit row, the chat post and the replay ledger are all 139's, in
 * one transaction under the league row lock.
 *
 * Q63 (ruled 2026-09-27): autopilot is OFF by default; the commissioner (and
 * co-commissioners) put a team on autopilot with this switch. No reminder or
 * notification rides it — only the §10.3 post the verb always writes.
 *
 * REASON — OPTIONAL (Q66). The schema is `optionalReason` (one shape for
 * every commissioner route): trimmed, ≤ 500, blank normalised to ABSENT.
 *
 * SQLSTATE mapping is the family's (`inseason-errors.ts`), imported never
 * re-derived; only the 42501 copy is this route's. Refusal text verbatim.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy — one no-leak string for "no such league" and "not
 *  a commissioner" alike. */
export const COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner or a co-commissioner can put a team on autopilot.'

/** The 409 for a REUSED action_id naming a different switch (the F65(b) class). */
export const COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the change you just made. Check the team’s autopilot and try again.'

/** `POST …/commish/autopilot` — `commish_set_autopilot(team_id, on, reason)`. */
export const commishSetAutopilotInputSchema = z.strictObject({
  team_id: normalizedUuid,
  on: z.boolean(),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishSetAutopilotInput = z.infer<typeof commishSetAutopilotInputSchema>

/** 139's result document, returned whole; nothing here narrows it. */
export interface CommishSetAutopilotResult {
  league_id: string
  verb: 'commish_set_autopilot'
  action_type: 'set_autopilot'
  action_id: string
  season: number
  team_id: string
  team_name: string
  team_status: string
  /** The switch AFTER this call (the stored value on a no-op). */
  autopilot: boolean
  previous: boolean
  /** What was asked — the F65(b) guard compares it with the body sent. */
  requested: boolean
  seat: 'unmanaged' | 'managed' | 'no_league_members_row'
  seat_why: string
  /** What the switch does, in words (rule 15). */
  effect: string
  affected_team_ids: string[]
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  bypassed: string[]
  bypassed_why: string
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  requested?: unknown
}

/**
 * POST /api/leagues/[id]/commish/autopilot — the audited per-team switch.
 *
 * 200 for both a fresh switch and a replay of the same submit; the body is
 * 139's document whole.
 */
export async function commishSetAutopilot(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishSetAutopilotInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, on, action_id, reason } = parsed.data

  // 139's order: (league, team, on, reason, action_id). An absent reason is
  // OMITTED (typegen: `p_reason?: string`; DEFAULT NULL).
  const { data, error } = await supabase.rpc('commish_set_autopilot', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_on: on,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a switch is (team, on) + the verb + the id. 139
  // echoes `team_id` and `requested` as sent, and its replay is keyed on
  // (league_id, action_id) alone, so a reused id would otherwise return the
  // FIRST submit's document as a 200 for a switch nobody flipped.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_set_autopilot' ||
    result.action_id !== action_id ||
    result.team_id !== team_id ||
    result.requested !== on
  ) {
    return { status: 409, body: { error: COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
