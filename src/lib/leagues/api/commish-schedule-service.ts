/**
 * Commissioner schedule override service — M6A task L.E1.11,
 * `POST /api/leagues/[id]/commish/schedule` (spec §15.4:1700 →
 * `commish_edit_schedule`); migration 130, re-cut by 131; PROGRESS D351.
 *
 * `commish-matchup-service.ts` / `commish-roster-service.ts` are the
 * templates (D351: copied, not re-derived): thin Route Handler, everything
 * testable here over an INJECTED client (D68/D71). The whole verb is the
 * RPC's (server-authoritative — CLAUDE.md): the week / matchup / kickoff
 * gates it lifts and NAMES in `bypassed[]`, the sibling re-pairing, the
 * every-team-once legality gate it keeps, the audit row and the chat post
 * are all 130's, in one transaction under the league row lock. This layer
 * computes nothing about schedules.
 *
 * REASON — OPTIONAL (Q66, ruled by Chris 2026-09-16, spec v2.16.41). The
 * schema is `optionalReason` (one shape for every commissioner route):
 * trimmed, ≤ 500, blank / tab-only normalised to ABSENT (never `''`). No
 * transitional state remains: 130 shipped under the ruling and 131 swept the
 * rest, so a no-reason request LANDS with a NULL-reason receipt, a post with
 * no `— reason:` clause and `reason_required: false` in the document — the
 * stack suite pins that end to end.
 *
 * SQLSTATE mapping is the family's (`inseason-errors.ts`), imported never
 * re-derived; only the 42501 copy is this route's. Refusal text verbatim.
 *
 * Sibling of the M4 manager-window route (`/schedule/matchup` →
 * `schedule_edit_matchup`, `schedule-service.ts`), which is NOT this door:
 * that verb keeps every timing gate; this one is the override.
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
 *  a commissioner" alike; it names the ordinary door. */
export const COMMISH_SCHEDULE_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can override a matchup. Before Week 1 kicks off, the schedule editor is the ordinary way to change one.'

/** The 409 for a REUSED action_id naming a different edit (the F65(b) class). */
export const COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the matchup edit you just submitted. Check the schedule and try again.'

/** `POST …/commish/schedule` — `commish_edit_schedule(matchup_id, home,
 *  away, reason)` (130:781-788's signature, which §15.4:1700 prints as
 *  `(...)`). Home and away naming the same team is 130's own 22023
 *  (`130:338`); mirrored here as a field error so the form can route it. */
export const commishEditScheduleInputSchema = z
  .strictObject({
    matchup_id: normalizedUuid,
    home_team_id: normalizedUuid,
    away_team_id: normalizedUuid,
    action_id: normalizedUuid,
    reason: optionalReason,
  })
  .refine((body) => body.home_team_id !== body.away_team_id, {
    path: ['away_team_id'],
    message: 'home and away name the same team — a matchup needs two',
  })
export type CommishEditScheduleInput = z.infer<typeof commishEditScheduleInputSchema>

/** 130's result document (`130:724-763`), returned whole; nothing here
 *  narrows it. `reason` is `string | null` under Q66 (130 §0) — never render
 *  the word "null". `reason_required` is the literal FALSE since 131 and is
 *  KEPT for the panel (F361). */
export interface CommishEditScheduleResult {
  league_id: string
  verb: 'commish_edit_schedule'
  action_type: 'edit_schedule'
  action_id: string
  season: number
  week: number
  round_type: string
  week_status: 'upcoming' | 'live' | 'correction_window' | 'final'
  matchup_status: string
  matchup: {
    matchup_id: string
    before: { home_team_id: string; away_team_id: string }
    after: { home_team_id: string; away_team_id: string }
  }
  /** The rows the edit displaced and re-seated, each with before/after. */
  siblings: unknown[]
  rows_changed: number
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  /** Every gate the override walked past, by name. */
  bypassed: string[]
  bypassed_why: Record<string, string>
  /** D353 — every team whose pairing this touched. */
  affected_team_ids: string[]
  /** What scoring did NOT do (§4 rule 15) — null on a no-op. */
  scoring: unknown
  reason_required: false
  window: unknown
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  matchup?: { matchup_id?: unknown; after?: { home_team_id?: unknown; away_team_id?: unknown } }
}

/**
 * POST /api/leagues/[id]/commish/schedule — the audited re-pairing of one
 * matchup (§15.4:1700 → `commish_edit_schedule`).
 *
 * 200 for both a fresh edit and a replay of the same submit; the body is
 * 130's document whole.
 */
export async function commishEditSchedule(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishEditScheduleInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { matchup_id, home_team_id, away_team_id, action_id, reason } = parsed.data

  // 130:781's order: (league, matchup, home, away, reason, action_id). An
  // absent reason is OMITTED (typegen: `p_reason?: string`; DEFAULT NULL).
  const { data, error } = await supabase.rpc('commish_edit_schedule', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_home: home_team_id,
    p_away: away_team_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_SCHEDULE_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a schedule edit is (matchup, home, away) + the verb
  // + the id. 130 echoes the requested pairing verbatim in `matchup.after`
  // (`130:742`) and its replay is keyed on (league_id, action_id) alone
  // (`130:362-367`), so a reused id would otherwise return the FIRST
  // submit's document as a 200 for an edit nobody made.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_edit_schedule' ||
    result.action_id !== action_id ||
    result.matchup?.matchup_id !== matchup_id ||
    result.matchup?.after?.home_team_id !== home_team_id ||
    result.matchup?.after?.away_team_id !== away_team_id
  ) {
    return { status: 409, body: { error: COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
