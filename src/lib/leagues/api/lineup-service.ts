/**
 * Lineup service — M4 task L.D4.1, `PATCH /api/leagues/[id]/teams/[tid]/lineup`
 * (spec §15.3, §11.2, §12.13; migration 112's `set_lineup`, replaced against
 * its file text by 114 (Q34(A) — `per_player_kickoff` is the only lock);
 * PROGRESS D293/D308/D311; the contract this route inherits is ledger row
 * **F224(e)**).
 *
 * Same D68/D71 layering as `transactions-service.ts` (extend, never fork):
 * the Route Handler is auth + param plumbing, and everything testable lives
 * here over an INJECTED Supabase client so the stack suite
 * (`lineup-api-db.test.ts`) drives the production composition across the
 * real PostgREST wire.
 *
 * **The whole verb is the RPC's** (server-authoritative — CLAUDE.md). This
 * layer computes nothing about slots, eligibility, locks or IR: the bipartite
 * fit (E16), the per-player kickoff lock read from `nfl_games` at transaction
 * `now()` (E42/§23.3), `allow_illegal_lineups`, the IR stint law and the
 * commissioner arm's reason are all 112/114's, inside one transaction under
 * the league row lock. What this layer owns is the wire shape, the
 * idempotency stamp, and making the refusal READABLE.
 *
 * F224(e), clause by clause:
 *   - the client sends the **FULL canonical `slot_map`, IR keys included** —
 *     `{ "<slot_key>:<index>": "<player_id>" }` (§12.13). An empty slot is an
 *     ABSENT key (112 refuses a null value with 22023), and an absent IR key
 *     is a REMOVAL from IR (§11.2: "an IR key absent from a submitted map is
 *     a removal"). The route forwards the map whole and never fills, trims
 *     or reorders it: the server returns the canonical map, naming the
 *     moves it made (`rearranged` + `moved[]`);
 *   - **one `action_id` per submit, reused on retry** — REQUIRED on the wire
 *     (E2/D68(1)). 112 replays by `(league_id, action_id)` through the
 *     `lineup_actions` ledger and returns the stored result byte-identically,
 *     so a React Query retry is a replay, never a second write;
 *   - the SQLSTATE mapping is the family's (`inseason-errors.ts`: 42501 → 403
 *     · P0002 → 404 · P0001 → 409 · 22023 → 400);
 *   - **the refusal text is surfaced verbatim** — never swallowed, never
 *     re-worded. §11.2 requires the lock refusal to NAME the player and his
 *     kickoff ("slot wr:0 is locked — Vitest LU WR A kicked off at … and a
 *     locked slot's player never moves … every other unlocked slot stays
 *     editable"); the E16 refusal names the player, the slot and what it
 *     accepts; the IR refusal names the stint's weeks. That text IS the UX
 *     (L.D5.1 renders it) — nothing here replaces it with "Something went
 *     wrong";
 *   - the result carries what L.D5.1 must render (R779): `flags`
 *     (bye/out/empty/ir_ineligible), `rearranged` + `moved[]`, `no_changes`
 *     as its own state, and `locked_at` — the RECORD of the earliest kickoff
 *     among the starters, rendered as "locks at", never as the lock itself
 *     (§11.2: the decider is `nfl_games.kickoff_at` at evaluation time). The body handed
 *     to the client is the RPC's document whole, so nothing is narrowed.
 *
 * **The F65(b) identity guard, applied here (CLAUDE.md's "never let 'nothing
 * happened' mean 'it worked'").** 112's replay branch is keyed on
 * `(league_id, action_id)` ALONE — not on the team, the week or the map —
 * so a caller who reuses their own `action_id` for a different team, week or
 * placement gets the ORIGINAL document back with no error, and answering 200
 * would report a lineup the caller never set. The result carries `team_id`,
 * `week`, `action_id`, the canonical `slot_map` and `moved[]`, so the check
 * costs no extra query. The placement half is stronger than a value
 * comparison because E16 may legitimately RE-SEAT a submitted placement: a
 * submitted `(key → player)` is accounted for when the canonical map holds
 * it verbatim OR `moved[]` names that player moving FROM that key, and the
 * two maps must place exactly the same players. A same-submit replay passes
 * trivially (its own stored document); a reuse for a different arrangement
 * fails one of the two halves and is refused as a 409.
 *
 * **R768 — the guard compares against what POSTGRES wrote.** `team_id` (the
 * path segment) and `action_id` are lower-cased before the RPC or the guard
 * sees them (`inseason-ids.ts`): `z.uuid()` accepts an uppercase uuid,
 * Postgres always returns lowercase, and without the normalisation an
 * uppercase submit would COMMIT and then be reported as a 409 with its
 * `action_id` spent.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): the `action_id` is minted per submit by the HOOK
 * (`use-lineup.ts`), the D114(5)/D68(1) precedent; the lock instant is the
 * database's transaction `now()`, never anything this layer supplies
 * (D307(3)).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy. 112 raises ONE no-leak 42501 for "nonexistent
 *  league / not a member / not this team's manager and not a commissioner",
 *  so this string distinguishes none of them. */
export const LINEUP_FORBIDDEN_MESSAGE =
  'Only this team’s manager (or the commissioner) can set its lineup.'

/** The 409 for a REUSED action_id that names a different lineup (the F65(b)
 *  class). An `action_id` is consumed forever, so the copy asks for a fresh
 *  gesture — which mints a fresh id — never for a retry of this submit. */
export const LINEUP_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the lineup you just submitted. Check your lineup and try again.'

/** A slot instance key — `"<slot_key>:<index>"` (§12.13). Which keys exist is
 *  the league's `roster_settings` question and 112 answers it with a named
 *  22023; this is a shape ceiling, never product law. */
const slotKey = z.string().trim().min(1).max(32)
/** `players.id` is TEXT (the provider's id), not a uuid — a shape ceiling. */
const playerId = z.string().trim().min(1).max(64)

/**
 * The commissioner arm's reason (R738/D290) — OPTIONAL (Q66, spec v2.16.41;
 * PROGRESS F363(b), M6A L.E1.12). Since migration 131 `set_lineup`'s
 * commissioner arm NORMALISES a blank reason to NULL instead of refusing it,
 * so a field-level 400 on `''` was the route disagreeing with the verb. The
 * shape is `optionalReason`'s (`commish-matchup-service.ts`) plus this door's
 * pre-existing `null`: absent / null / blank / whitespace-only all normalise
 * to ABSENT (never `''` on the wire), a non-blank reason is trimmed, > 500
 * (the league_chat bound) and a non-string are still field errors. Never
 * `.min(1)`.
 */
export const lineupReason = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value ? value : undefined))

/**
 * The wire body. `slot_map` is the FULL canonical map (F224(e)): every
 * started player under its slot instance, every IR player under its IR key,
 * nothing for an empty slot. `reason` is `lineupReason` above — optional.
 */
export const setLineupInputSchema = z.strictObject({
  week: z.number().int().min(1).max(18),
  slot_map: z.record(slotKey, playerId),
  // Normalised at the schema (R768): the F65(b) guard compares this against
  // the value POSTGRES wrote. See `inseason-ids.ts`.
  action_id: normalizedUuid,
  reason: lineupReason,
})
export type SetLineupInput = z.infer<typeof setLineupInputSchema>

/** One `starters[]` entry as 112 writes it — the slot instance, the player
 *  placed there (or null for an empty slot), his position, his kickoff for
 *  the week as read from `nfl_games` at the write, and the flags L.D5.1
 *  renders (`bye`, `out`, `empty`, `ir_ineligible`). */
export interface LineupStarter {
  slot: string
  slot_key: string
  label: string | null
  player_id: string | null
  position: string | null
  kickoff_at: string | null
  flags: string[]
}

/** 112's result document — the stored `lineup_actions.result`, returned
 *  whole. The fields F224(e)/R779 name as the route's rendering duty are
 *  called out; the rest rides along untouched. */
export interface SetLineupResult {
  league_id: string
  team_id: string
  season: number
  week: number
  /** The league's current week as the server evaluated it (§11.2 — the
   *  greatest `league_weeks` week whose `nfl_weeks.starts_at` ≤ now). */
  current_week: number
  action_id: string
  lineup_lock: 'per_player_kickoff'
  allow_illegal_lineups: boolean
  /** R779: a NO-OP is its own state — the canonical map equalled the stored
   *  one and no IR move happened; nothing was written but the ledger row. */
  no_changes: boolean
  /** E16: the server re-seated a per-slot-invalid placement along an
   *  augmenting path. `moved[]` names each move (`from` is the submitted
   *  key, null when the player was newly placed). */
  rearranged: boolean
  moved: Array<{ player_id: string; from: string | null; to: string }>
  /** THE canonical map — render this, not what was submitted. */
  slot_map: Record<string, string>
  starters: LineupStarter[]
  bench: string[]
  ir: unknown[]
  ir_moves: { placed: unknown[]; removed: unknown[] }
  flags: {
    illegal: boolean
    bye: unknown[]
    out: unknown[]
    empty: unknown[]
    ir_ineligible: unknown[]
  }
  /** The RECORD of the earliest kickoff among the STARTERS at the write —
   *  the instant the lineup begins locking (NULL for a bye-only lineup).
   *  Render as "locks at" — it may still be ahead, and it is never the
   *  decider (§11.2; rule 9; R779). */
  locked_at: string | null
  edited_by_commish: boolean
  reason: string | null
  system_post: string | null
  evaluated_at: string
  week_datum: { first_kickoff_at: string | null; datum_arm: string; kicked_off: boolean }
  current_week_datum: { first_kickoff_at: string | null; datum_arm: string; kicked_off: boolean }
}

/** The slice of 112's result this layer READS for the identity guard. */
interface SetLineupResultShape {
  team_id?: unknown
  week?: unknown
  action_id?: unknown
  slot_map?: unknown
  moved?: unknown
}

/**
 * The placement half of the F65(b) guard — pure, exported for its own pins.
 *
 * `submitted` is accounted for by `canonical` + `moved` when every submitted
 * `(key → player)` is either held verbatim by the canonical map or named in
 * `moved[]` as that player moving FROM that key, AND both maps place exactly
 * the same players (a reuse that swaps one player for another fails here
 * even if every surviving key still matches).
 */
export function placementMatches(
  submitted: Record<string, string>,
  canonical: unknown,
  moved: unknown,
): boolean {
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) return false
  const canon = canonical as Record<string, unknown>
  const moves = Array.isArray(moved) ? (moved as Array<Record<string, unknown>>) : []
  for (const [key, playerId] of Object.entries(submitted)) {
    if (canon[key] === playerId) continue
    const movedFromHere = moves.some((m) => m.player_id === playerId && m.from === key)
    if (!movedFromHere) return false
  }
  const submittedPlayers = Object.values(submitted).sort()
  const canonicalPlayers = Object.values(canon)
    .filter((v): v is string => typeof v === 'string')
    .sort()
  if (submittedPlayers.length !== canonicalPlayers.length) return false
  return submittedPlayers.every((p, i) => p === canonicalPlayers[i])
}

/**
 * PATCH /api/leagues/[id]/teams/[tid]/lineup — set this week's lineup (§15.3
 * → `set_lineup`).
 *
 * 200 for both a fresh set and a replay of the same submit (the draft
 * family's replayed-submit convention); the body is 112's document whole.
 */
export async function setLineup(
  supabase: Supabase,
  leagueId: string,
  rawTeamId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  // The team id is a PATH segment the route has already shape-checked; it is
  // normalised here because the guard below compares it against Postgres's
  // rendering (R768).
  const teamParsed = normalizedUuid.safeParse(rawTeamId)
  if (!teamParsed.success) {
    return { status: 404, body: { error: 'Team not found' } }
  }
  const teamId = teamParsed.data

  const parsed = setLineupInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { week, slot_map, action_id, reason } = parsed.data

  const { data, error } = await supabase.rpc('set_lineup', {
    p_league_id: leagueId,
    p_team_id: teamId,
    p_week: week,
    p_slot_map: slot_map,
    p_action_id: action_id,
    // Optional arg: OMIT rather than send null (the members-service rule —
    // the generated Args type cannot express per-arg nullability, and 112
    // defaults it to NULL).
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) {
    return mapInSeasonRpcError(error, LINEUP_FORBIDDEN_MESSAGE)
  }

  // F65(b): the document that came back must be THIS submit — fresh, or the
  // same submit replayed. A mismatch means the action_id was consumed by a
  // different lineup, and 112's replay returns it without error; answering
  // 200 would attribute a lineup the caller never set.
  const result = (data ?? {}) as SetLineupResultShape
  if (
    result.team_id !== teamId ||
    result.week !== week ||
    result.action_id !== action_id ||
    !placementMatches(slot_map, result.slot_map, result.moved)
  ) {
    return { status: 409, body: { error: LINEUP_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}
