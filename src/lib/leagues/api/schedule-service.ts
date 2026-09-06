/**
 * Schedule Remix service — M4 task L.D4.2, `POST /api/leagues/[id]/schedule/
 * remix` (preview) and `POST /api/leagues/[id]/schedule/confirm` (apply)
 * (spec §15.3, §11.7; migration 111's `schedule_preview` /
 * `schedule_remix_confirm`; PROGRESS D289/D290/D307).
 *
 * **THE ONE LAW THIS FILE EXISTS TO KEEP: the client sends a SEED, never a
 * SCHEDULE.** §11.7's Remix is "regenerate the schedule with a new seed", and
 * D289 puts the generator in SQL as the single implementation. So the wire
 * carries one 31-bit integer and `schedule_remix_confirm` re-runs
 * `schedule_remix_plan_internal(league, seed, now())` IN ITS OWN BODY and
 * writes what IT produced — a caller cannot hand the server a set of
 * matchups, a diff, or a list of weeks and have any of it applied. Both
 * bodies are `strictObject`s for that reason: an unrecognized key is a 400,
 * not something quietly dropped on the way to an RPC that would have ignored
 * it anyway. (This is the L.D4.2 DoD's break probe: relax the strictness and
 * the pins in `inseason-routes.test.ts` + `schedule-api-db.test.ts` go red.
 * R771: this line named `schedule-routes.test.ts`, which does not exist —
 * the handler pins live in `inseason-routes.test.ts` with the other three
 * routes'.)
 *
 * Preview → confirm is a two-call round trip over the SAME seed, held by the
 * client between the calls: the commissioner sees `diff`/`weeks_frozen`/
 * `change_count` from `schedule_preview`, then confirms THAT seed. Confirm
 * re-derives everything; the preview is never an input to it.
 *
 * E41's free window (before the league's first kickoff) is evaluated at
 * TRANSACTION time inside 111, never from a caller-supplied instant, and
 * `reason` is required only outside it — so this layer accepts `reason`
 * optionally and lets the RPC decide, rather than mirroring a rule it cannot
 * evaluate correctly (D307). The refusal names what is needed.
 *
 * The `action_id` is lower-cased at the schema (R768, `inseason-ids.ts`):
 * the replay guard below compares it against the value 111 STORED, which
 * Postgres renders lowercase, while `z.uuid()` accepts either case. Without
 * the normalisation an uppercase confirm applied the remix and was then
 * reported to the commissioner as a 409, its `action_id` spent.
 *
 * `action_id` is REQUIRED on the wire even though 111's signature defaults it
 * (Postgres forbids a default before a non-default — D307): the RPC requires
 * it in-body, `schedule_actions` is the replay ledger, and a replay returns
 * the stored result byte-identically even after a later Remix replaced every
 * row the first one wrote.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): the seed and the `action_id` are minted per gesture by the HOOK
 * (`use-schedule.ts`), the D112(3)/D114(5) precedent for injected entropy.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { SCHEDULE_SEED_MAX } from '../settings/league-settings'
import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** 111 raises ONE no-leak 42501 for "nonexistent league / not a member / not
 *  the commissioner" — this copy distinguishes none of them. */
export const SCHEDULE_FORBIDDEN_MESSAGE =
  'Only the commissioner can remix this league’s schedule.'

/** The 409 for a reused `action_id` naming a different seed. An action_id is
 *  consumed forever, so the copy asks for a fresh Remix rather than a retry
 *  of this submit. */
export const SCHEDULE_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the remix you previewed. Preview it again and confirm.'

/** The §11.7 seed space, shared with the settings catalog (`schedule_seed`
 *  is a stored setting — `league-settings.ts:327`) so the wire, the blob and
 *  111's own 22023 guard all agree on one range. */
const scheduleSeed = z.number().int().min(0).max(SCHEDULE_SEED_MAX)

/**
 * The preview body. **`strictObject` is load-bearing** — see the header: a
 * `matchups`/`proposed`/`weeks` key is refused, not ignored.
 */
export const previewRemixInputSchema = z.strictObject({
  seed: scheduleSeed,
})
export type PreviewRemixInput = z.infer<typeof previewRemixInputSchema>

/**
 * The confirm body. `seed` is the one thing carried over from the preview;
 * everything else about the applied schedule is re-derived in-body.
 * **`strictObject` is load-bearing** — see the header.
 */
export const confirmRemixInputSchema = z.strictObject({
  seed: scheduleSeed,
  reason: z.string().trim().max(500).nullish(),
  action_id: normalizedUuid,
})
export type ConfirmRemixInput = z.infer<typeof confirmRemixInputSchema>

/** POST …/schedule/remix — the write-free preview (§15.3 "regenerate
 *  schedule w/ new seed → preview"). 200 with 111's plan: `diff`,
 *  `proposed`, `weeks_regenerable`, `weeks_frozen`, `change_count`,
 *  `no_changes`, and the E41 `window` (with `reason_required`). */
export async function previewRemix(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = previewRemixInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const { data, error } = await supabase.rpc('schedule_preview', {
    p_league_id: leagueId,
    p_seed: parsed.data.seed,
  })
  if (error) {
    return mapInSeasonRpcError(error, SCHEDULE_FORBIDDEN_MESSAGE)
  }
  return { status: 200, body: data as unknown as Json }
}

/**
 * POST …/schedule/confirm — apply a previewed remix (§15.3 "atomic; system
 * chat post").
 *
 * EXACTLY four arguments reach the RPC: the league (from the URL), the seed,
 * the optional reason and the idempotency key. There is no fifth, and there
 * is nowhere for a client-supplied schedule to enter — 111 regenerates from
 * the seed and asserts the engine's own arithmetic before writing.
 *
 * 200 for both a fresh confirm and a replay of the same submit.
 */
export async function confirmRemix(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = confirmRemixInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { seed, reason, action_id } = parsed.data

  const { data, error } = await supabase.rpc('schedule_remix_confirm', {
    p_league_id: leagueId,
    p_seed: seed,
    p_action_id: action_id,
    // Omit rather than send null (the members-service rule); 111 treats an
    // absent reason and a NULL reason identically and decides from E41's
    // window whether one was required.
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) {
    return mapInSeasonRpcError(error, SCHEDULE_FORBIDDEN_MESSAGE)
  }

  // The replay guard's transactions-route sibling (F65(b)): 111's ledger is
  // keyed `(league_id, action_id)` and CHECKS `kind`, so a reused id from
  // another verb already raises — but an id reused for a DIFFERENT SEED
  // returns the first confirm's stored result with no error, which would
  // report a schedule the caller never asked for. The stored result carries
  // its own `schedule_seed`, so the check costs no extra query.
  const result = (data ?? {}) as { schedule_seed?: unknown; action_id?: unknown }
  if (result.action_id !== action_id || Number(result.schedule_seed) !== seed) {
    return { status: 409, body: { error: SCHEDULE_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

// ---------------------------------------------------------------------------
// The manual matchup edit — §11.7 "Manual per-matchup editing (drag Team A ↔
// Team C for Week 7) stays available in the same tool, same audit rules"
// (M4 task L.D5.3; PROGRESS F233(e) — 111 shipped the verb with no route;
// D290's interim audit posture; the R768 normalisation inherited).
//
// THIS VERB NAMES ONE MATCHUP'S TWO TEAMS, AND THAT IS NOT A SCHEDULE. The
// law at the top of this file is that a Remix carries a SEED and the server
// generates the season; an edit is the spec's other door — the commissioner
// names a pairing, and 111 re-seats the displaced teams itself (the parked
// permutation, D307(6)) and re-validates the week in-body (every team once,
// E40). The body is still a `strictObject`: exactly one matchup, its two
// teams, an optional reason and the key — a `matchups`/`proposed`/`weeks`
// array is REFUSED here too, and `inseason-routes.test.ts` scopes its
// "no matchup-shaped payload" pin to the REMIX half above this marker.
//
// E41 is evaluated at transaction time inside 111 (D307(3)): free until the
// league's Week 1 kickoff, a `reason` REQUIRED after it (22023 → 400, the
// refusal verbatim — the modal renders it and marks the field). This layer
// mirrors no window rule it cannot evaluate; a blank reason is sent as ''
// (111 reads '' and NULL identically — `NULLIF(btrim(...), '')`) because the
// generated signature has no default for `p_reason`.
// ---------------------------------------------------------------------------

/** The 409 for a reused `action_id` naming a different edit (F65(b)). */
export const SCHEDULE_EDIT_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the edit you made. Check the schedule and try the edit again.'

/**
 * The edit body. **`strictObject` is load-bearing** — see the section note.
 * `matchup_id` and the two team ids go through `normalizedUuid` because the
 * result guard compares them against what 111 STORED (R768).
 */
export const editMatchupInputSchema = z.strictObject({
  matchup_id: normalizedUuid,
  home_team_id: normalizedUuid,
  away_team_id: normalizedUuid,
  reason: z.string().trim().max(500).nullish(),
  action_id: normalizedUuid,
})
export type EditMatchupInput = z.infer<typeof editMatchupInputSchema>

/**
 * POST …/schedule/matchup — re-pair ONE scheduled regular-season matchup
 * (§11.7 → `schedule_edit_matchup`, migration 111; atomic, with the D97
 * system chat post written in the same transaction).
 *
 * EXACTLY six arguments reach the RPC: the league (from the URL), the
 * matchup, the two teams, the reason and the idempotency key. Every rule —
 * commissioner-only, `in_season`, the matchup's own week `upcoming` and not
 * yet kicked off, `scheduled` / unscored / un-overridden, both teams seated
 * franchises of this league, E41's reason — is 111's, in-body, and its
 * refusal is passed through verbatim by the family mapper.
 *
 * 200 for both a fresh edit and a replay of the same submit.
 */
export async function editMatchup(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = editMatchupInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { matchup_id, home_team_id, away_team_id, reason, action_id } = parsed.data

  const { data, error } = await supabase.rpc('schedule_edit_matchup', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_home: home_team_id,
    p_away: away_team_id,
    p_reason: reason ?? '',
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, SCHEDULE_FORBIDDEN_MESSAGE)
  }

  // The F65(b) identity guard, the confirm's sibling: 111's ledger is keyed
  // `(league_id, action_id)` and checks `kind` only, so an id reused for a
  // DIFFERENT matchup or pairing returns the first edit's stored result with
  // no error. The stored result carries the matchup and its `after` pairing,
  // so the check costs no extra query.
  const result = (data ?? {}) as {
    action_id?: unknown
    matchup?: { matchup_id?: unknown; after?: { home_team_id?: unknown; away_team_id?: unknown } }
  }
  if (
    result.action_id !== action_id ||
    result.matchup?.matchup_id !== matchup_id ||
    result.matchup?.after?.home_team_id !== home_team_id ||
    result.matchup?.after?.away_team_id !== away_team_id
  ) {
    return { status: 409, body: { error: SCHEDULE_EDIT_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
