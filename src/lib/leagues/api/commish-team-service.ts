/**
 * Commissioner team rename service — M6A task L.E1.11,
 * `POST /api/leagues/[id]/commish/team` (spec §15.4's v2.16.39 erratum →
 * `commish_rename_team`); migration 128, re-cut by 131; PROGRESS D351.
 *
 * `commish-matchup-service.ts` / `commish-roster-service.ts` are the
 * templates (D351: copied, not re-derived): thin Route Handler, everything
 * testable here over an INJECTED client (D68/D71). The whole verb is the
 * RPC's (server-authoritative — CLAUDE.md): the name gate, the sealed-
 * franchise refusal (`spec:183`, a LEGALITY gate that binds the commissioner
 * too), the collision report, the audit row and the chat post are all 128's,
 * in one transaction under the league row lock.
 *
 * THIS IS THE COMMISSIONER'S DOOR ONLY. 128 also ships `rename_own_team`, the
 * MANAGER's own rename of his own franchise (no §10.1 power, no receipt, no
 * post — `128:696-873`). It is not a `/commish/` verb and is deliberately not
 * exposed here; L.E1.13 wires the manager's arm on the team page.
 *
 * REASON — OPTIONAL (Q66, ruled by Chris 2026-09-16, spec v2.16.41). The
 * schema is `optionalReason` (one shape for every commissioner route):
 * trimmed, ≤ 500, blank / tab-only normalised to ABSENT (never `''`). Since
 * migration 131 (L.E1.15, F362) 128's in-body gate is a normalisation, so a
 * no-reason request LANDS with a NULL-reason receipt and a post with no
 * `— reason:` clause — the stack suite pins that end to end.
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
 *  a commissioner" alike; it names the manager's own door. */
export const COMMISH_TEAM_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can rename another team. A team’s own manager renames it from the team page.'

/** The 409 for a REUSED action_id naming a different rename (the F65(b) class). */
export const COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the rename you just submitted. Check the team’s name and try again.'

/** `POST …/commish/team` — `commish_rename_team(team_id, name, reason)`
 *  (128:637-643's signature). The name bound is 128's own (100 — the
 *  league-rename bound, `128:365-369`), mirrored here as a field error so
 *  the form can route it; JS `trim()` strips a superset of 128's explicit
 *  class (` \t\r\n`), so what reaches the wire is already what 128 stores
 *  and echoes as `requested_name`. */
export const commishRenameTeamInputSchema = z.strictObject({
  team_id: normalizedUuid,
  name: z.string().trim().min(1).max(100),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishRenameTeamInput = z.infer<typeof commishRenameTeamInputSchema>

/** 128's result document (`128:586-616`), returned whole; nothing here
 *  narrows it. `action_type` is `'reassign_team'` — tasks-M6A §5's
 *  contractual string, and F355 records that the word does not mean
 *  "rename" to a reader. `reason` is `string | null` under Q66 (130 §0). */
export interface CommishRenameTeamResult {
  league_id: string
  verb: 'commish_rename_team'
  action_type: 'reassign_team'
  action_id: string
  season: number
  team_id: string
  team_status: string
  /** The name the franchise carries AFTER this call (the old one on a no-op). */
  name: string
  previous_name: string
  requested_name: string
  /** Teams in this league already carrying the same name (case-folded) —
   *  MEASURED, never a refusal (128 §7). */
  name_collides_with: unknown
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  /** Always empty for a rename — and `bypassed_why` says why. */
  bypassed: string[]
  bypassed_why: string
  propagation: {
    live: true
    live_why: string
    frozen_receipts_for_this_team: number
    history_rewritten: false
    history_not_rewritten_why: string
  }
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  team_id?: unknown
  requested_name?: unknown
}

/**
 * POST /api/leagues/[id]/commish/team — the audited rename of any franchise
 * (§15.4 v2.16.39 erratum → `commish_rename_team`).
 *
 * 200 for both a fresh rename and a replay of the same submit; the body is
 * 128's document whole.
 */
export async function commishRenameTeam(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishRenameTeamInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, name, action_id, reason } = parsed.data

  // 128:637's order: (league, team, name, reason, action_id). An absent
  // reason is OMITTED (typegen: `p_reason?: string`; DEFAULT NULL).
  const { data, error } = await supabase.rpc('commish_rename_team', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_name: name,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_TEAM_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a rename is (team, name) + the verb + the id. 128
  // echoes `team_id` as sent and `requested_name` as normalised
  // (`128:592`, `128:596`) — identical to the schema's trimmed `name` — and its
  // replay is keyed on (league_id, action_id) alone, so a reused id would
  // otherwise return the FIRST submit's document as a 200 for a rename
  // nobody made.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_rename_team' ||
    result.action_id !== action_id ||
    result.team_id !== team_id ||
    result.requested_name !== name
  ) {
    return { status: 409, body: { error: COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
