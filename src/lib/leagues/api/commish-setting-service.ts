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
 * THE IDENTITY GUARD AND THE VALUE (F65(b), D351, R1058). 129 echoes the
 * key and the rescore flag as sent, but the value only in CANONICAL form
 * (`requested_value` is `v_canon`, `129:1076` — `"72"` comes back as `72`
 * for an integer key, R1040's canonicaliser rebuilds `roster_settings` from
 * its known keys and drops the rest). A STRICT value compare would answer a
 * lawful FIRST submit sent in a non-canonical form with a 409 — a landed
 * change reported as a failure, the worst outcome this layer can produce —
 * but D351 says the identity guard covers the document's identity fields
 * and for a setting change the VALUE is one: a same-key DIFFERENT-value
 * replay of a spent id answered 200 with the first submit's document is
 * exactly the "change nobody made" F65(b) forbids (R1058's live probe: 72
 * then 96 landed, a replay of the first id with 120 was told 72 while the
 * blob held 96). So the guard compares the value TOLERANTLY, in the shape
 * 129's canonicalisers permit and NO WIDER (`settingValueMatchesEcho` —
 * narrowed by L.E1.13, PROGRESS F365 / R1062: the first cut lower-cased and
 * number-coerced EVERY scalar at EVERY depth, so `"FLEX"` for a stored
 * `"Flex"` slot label, or `bench: "6"` for `6`, replayed as a 200). The
 * tolerance is AT DEPTH 0 ONLY and PER 129's CLASS: a string is always
 * trimmed (`btrim`, every typed arm); integer TEXT matches an echoed number
 * (`::integer`, `129:376-378`); case is folded ONLY where 129 folds it — an
 * echoed boolean (`129:404-406`), an echoed `null` for `"none"`
 * (`129:466-467`, `trade_deadline_week`'s only null form), an echoed
 * `"unlimited"` (`129:585`, `:590`) and an echoed uuid (`129:536`); an enum
 * is trimmed and then compared EXACTLY. Everything NESTED — array elements
 * (129 keeps order, `129:522`), and every value inside `roster_settings`,
 * which 129 stores verbatim — is compared STRICTLY (`===`, same JSON type),
 * with ONE carve-out kept at every depth: an object is matched on THE KEYS
 * THE ECHO CARRIES (the sent object may carry keys R1040 drops — those must
 * not become a false 409). `"72"` ↔ `72` passes; `120` ↔ `72`, nested
 * `"FLEX"` ↔ `"Flex"` and `{bench:"6"}` ↔ `{bench:6}` are refused. This is
 * the INTERIM guard; the durable
 * fix (129 echoing the value AS SENT beside the canonical one, then an exact
 * compare) stays filed as PROGRESS F364.
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
  requested_value?: unknown
  rescore_requested?: unknown
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTEGER_TEXT = /^-?[0-9]+$/

/** STRICT, for everything nested: same JSON type and `===` on scalars,
 *  arrays element-wise in order, objects on every key THE ECHO carries
 *  (R1040's drops are the one tolerance that survives at depth). */
function nestedMatchesEcho(sent: Json | undefined, echo: unknown): boolean {
  if (echo === undefined) return false
  if (echo === null || typeof echo !== 'object') return sent === echo
  if (Array.isArray(echo)) {
    return Array.isArray(sent) && sent.length === echo.length && echo.every((e, i) => nestedMatchesEcho(sent[i], e))
  }
  if (sent === null || sent === undefined || typeof sent !== 'object' || Array.isArray(sent)) return false
  const sentObject = sent as { [key: string]: Json | undefined }
  return Object.entries(echo as Record<string, unknown>).every(([k, e]) => nestedMatchesEcho(sentObject[k], e))
}

/**
 * R1058 (D351 — the value is an identity field) as NARROWED by F365 / R1062:
 * does the value the caller SENT match the CANONICAL echo 129 returned as
 * `requested_value`? Tolerant at DEPTH 0 ONLY and per 129's class (see the
 * header), strict for everything nested:
 *
 *   - echo `null`      ⇐ sent `null`, or a `"none"` string in any case
 *                        (`129:466-467`);
 *   - echo boolean     ⇐ the same boolean, or its text in any case
 *                        (`129:404-406`);
 *   - echo number      ⇐ the same number, or trimmed INTEGER text of it
 *                        (`129:376-378`);
 *   - echo string      ⇐ a sent string, TRIMMED; case-folded only when the
 *                        echo is `"unlimited"` or uuid-shaped, else exact;
 *   - echo array       ⇐ same length, each element STRICT;
 *   - echo object      ⇐ every key the echo carries, each value STRICT —
 *                        sent extras are R1040's drops, never a mismatch;
 *   - echo absent (`undefined`) — no echo at all — is never a match.
 */
export function settingValueMatchesEcho(sent: Json | undefined, echo: unknown): boolean {
  if (echo === undefined) return false
  if (echo === null) {
    return sent === null || (typeof sent === 'string' && sent.trim().toLowerCase() === 'none')
  }
  if (typeof echo === 'object') return nestedMatchesEcho(sent, echo)
  if (typeof echo === 'boolean') {
    return sent === echo || (typeof sent === 'string' && sent.trim().toLowerCase() === String(echo))
  }
  if (typeof echo === 'number') {
    if (typeof sent === 'number') return sent === echo
    return typeof sent === 'string' && INTEGER_TEXT.test(sent.trim()) && Number(sent.trim()) === echo
  }
  if (typeof echo !== 'string' || typeof sent !== 'string') return false
  const trimmed = sent.trim()
  const folds = echo === 'unlimited' || UUID_SHAPE.test(echo)
  return folds ? trimmed.toLowerCase() === echo : trimmed === echo
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

  // F65(b): identity for a setting change is (key, value, rescore) + the verb
  // + the id. 129's replay is keyed on (league_id, action_id) alone
  // (`129:724-725`), so a reused id sent for a DIFFERENT key or value would
  // otherwise return the first submit's document as a 200. The value is
  // compared TOLERANTLY (R1058, the header): 129 echoes it canonicalised.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_change_setting' ||
    result.action_id !== action_id ||
    result.key !== key ||
    !settingValueMatchesEcho(value, result.requested_value) ||
    result.rescore_requested !== rescore
  ) {
    return { status: 409, body: { error: COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
