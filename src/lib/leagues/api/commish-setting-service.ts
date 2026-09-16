/**
 * Commissioner settings override service — M6A task L.E1.11,
 * `POST /api/leagues/[id]/commish/setting` (spec §15.4:1701 →
 * `commish_change_setting(key, value, rescore?, reason)`); migration 129,
 * re-cut by 131; PROGRESS D351, D347's per-key policy table, D360.
 *
 * `commish-matchup-service.ts` / `commish-roster-service.ts` are the
 * templates (D351: copied, not re-derived): thin Route Handler, everything
 * testable here over an INJECTED client (D68/D71). The whole verb is the
 * RPC's (server-authoritative — CLAUDE.md): which keys may change in-season
 * and which are refused BY NAME (`commish_setting_policy`, `129:300-345`),
 * the per-key canonicalisation and bounds, the per-key read-modify-write
 * (D347), the `rescore` arm, the audit row and the chat post are all 129's,
 * in one transaction under the league row lock. This layer validates the
 * SHAPE of the request only — ONE key per call, a JSON value, a flag — and
 * never mirrors 129's policy table (a mirror would drift; the refusal copy
 * arrives verbatim and L.E1.13 renders it).
 *
 * REASON — OPTIONAL (Q66, ruled by Chris 2026-09-16, spec v2.16.41). The
 * schema is `optionalReason` (one shape for every commissioner route):
 * trimmed, ≤ 500, blank / tab-only normalised to ABSENT (never `''`). Since
 * migration 131 (L.E1.15, F362) 129's in-body gate is a normalisation, so a
 * no-reason request LANDS with a NULL-reason receipt and a post with no
 * `— reason:` clause — the stack suite pins that end to end.
 *
 * THE IDENTITY GUARD'S ONE MEASURED LIMIT (F65(b)). 129 echoes the key and
 * the rescore flag as sent, but the value only in CANONICAL form
 * (`requested_value` is `v_canon`, `129:1076` — `"72"` comes back as `72`
 * for an integer key, R1040's canonicaliser strips unknown
 * `roster_settings` keys). A guard that compared the sent value to the echo
 * would answer a lawful FIRST submit sent in a non-canonical form with a 409
 * — a landed change reported as a failure, the worst outcome this layer can
 * produce. So the guard here is `verb` + `action_id` + `key` +
 * `rescore_requested`; a replay with a different VALUE for the same key
 * still returns the first submit's document. The hook mints one `action_id`
 * per submit, so that needs a client bug to reach; the closing fix (129
 * echoing the value AS SENT beside the canonical one) is filed as an F-row
 * in PROGRESS, not improvised here.
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
 *  a commissioner" alike; it names the ordinary door. */
export const COMMISH_SETTING_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can change a setting in-season. Before the draft, the settings panel is the ordinary way.'

/** The 409 for a REUSED action_id naming a different change (the F65(b) class). */
export const COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the setting change you just submitted. Check the league settings and try again.'

/** A settings key: `leagues` column names and §7.3 blob keys are all
 *  snake_case identifiers. The vocabulary itself is 129's policy table —
 *  an unknown key is 129's own refusal, verbatim, never a mirror here. */
const settingKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'a setting key is a snake_case identifier')

/** `POST …/commish/setting` — `commish_change_setting(key, value, rescore?,
 *  reason)` (§15.4:1701's printed order; 129:1110-1117's signature). The
 *  value is ANY JSON — 129 types it per key. `null` is a legal JSON value
 *  on the wire and reaches 129 as such (its integer / boolean / enum arms
 *  refuse a null by name, 22023 → 400). */
export const commishChangeSettingInputSchema = z.strictObject({
  key: settingKey,
  value: z.json(),
  rescore: z.boolean().default(false),
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishChangeSettingInput = z.infer<typeof commishChangeSettingInputSchema>

/** 129's result document (`129:1064-1092`), returned whole; nothing here
 *  narrows it. `value` / `previous_value` / `requested_value` are the
 *  CANONICAL jsonb. `reason` is `string | null` under Q66 (130 §0). */
export interface CommishChangeSettingResult {
  league_id: string
  verb: 'commish_change_setting'
  action_type: 'change_setting'
  action_id: string
  season: number
  league_status: string
  key: string
  storage: 'column' | 'blob'
  policy_class: 'free' | 'rescore' | 'bracket' | 'refused'
  /** The value stored AFTER this call (the previous one on a no-op). */
  value: Json
  previous_value: Json
  requested_value: Json
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  /** Every gate the override walked past, by name (118's status gate). */
  bypassed: string[]
  bypassed_why: unknown
  rescore_requested: boolean
  rescore_performed: boolean
  /** Names why a requested rescore did NOT happen (§4 rule 15). */
  rescore_not_performed_why: string | null
  /** What the change did and did not touch downstream — null on a no-op. */
  consequences: unknown
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  key?: unknown
  rescore_requested?: unknown
}

/**
 * POST /api/leagues/[id]/commish/setting — the audited in-season change of
 * ONE league setting (§15.4:1701 → `commish_change_setting`).
 *
 * 200 for both a fresh change and a replay of the same submit; the body is
 * 129's document whole.
 */
export async function commishChangeSetting(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishChangeSettingInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { key, value, rescore, action_id, reason } = parsed.data

  // §15.4:1701's printed order (key, value, rescore?, reason) + league first,
  // action_id last (129:1110). The value ALWAYS rides, `null` included —
  // omitting it would let 129's DEFAULT NULL stand for a value the caller
  // sent. An absent reason is OMITTED (typegen: `p_reason?: string`).
  const { data, error } = await supabase.rpc('commish_change_setting', {
    p_league_id: leagueId,
    p_key: key,
    p_value: value as Json,
    p_rescore: rescore,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_SETTING_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a setting change is (key, rescore) + the verb + the
  // id — NOT the value, for the measured reason in the header (129 echoes
  // the value canonicalised, `129:1076`). 129's replay is keyed on
  // (league_id, action_id) alone (`129:724-725`), so a reused id sent for a
  // DIFFERENT key would otherwise return the first key's document as a 200.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_change_setting' ||
    result.action_id !== action_id ||
    result.key !== key ||
    result.rescore_requested !== rescore
  ) {
    return { status: 409, body: { error: COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
