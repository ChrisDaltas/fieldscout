/**
 * The shared plumbing of the in-season READ routes (M4 task L.D4.1; spec
 * §12.0/§15.3; PROGRESS D92, tasks-M4 §4 rule 10): the membership gate and
 * the PostgREST-cap assertion the family's direct-read GETs (rosters,
 * matchups — and, since the #261 fix round, the activity feed) compose onto
 * — the `inseason-errors.ts` shape, one helper for the family.
 *
 * **Why a gate at all when the tables are RLS-scoped (D92).** `league_rosters`
 * (072), `matchups` / `team_week_results` / `league_player_pool` (109),
 * `team_lineups` (112) and `league_weeks` (056) are all member-SELECT, so a
 * non-member's read through the user's client returns ZERO rows — and a
 * route that rendered that as `{ teams: [] }` would be CLAUDE.md's "never let
 * 'nothing happened' mean 'it worked'" in its purest form: an empty league
 * and a forbidden league would be the same JSON. The rule is that an
 * RLS-empty result for a non-member must NOT render as an empty list —
 * assert membership FIRST, then read.
 *
 * **The predicate is the database's own.** `is_league_member(p_league_id)`
 * (052) is the SECURITY DEFINER function every one of those policies calls;
 * asking it directly means the route and the policies cannot disagree about
 * who a member is (F35: derived from `league_members`, never a stint). It
 * answers `false` for "no such league" and "not a member" alike, and this
 * helper keeps that one no-leak answer — a 403 whose copy names neither
 * case, the same posture 112/113/117 take with their single 42501
 * (`inseason-errors.ts`). `league_standings` (117) carries the check in-body
 * and raises 42501 itself; the two direct-read routes (rosters, matchups)
 * call this instead, so all three answer the same status with the same
 * shape for the same caller.
 *
 * **One posture for the whole in-season family (R807, F248(d) — ruled at PR
 * #261's review as house convention, not product).** The activity feed
 * (L.D4.2) first shipped answering a non-member an EMPTY feed under the
 * D114(5) league-read posture; spec §11.5 (v2.16.23) says a non-member is
 * "refused by name, never handed an empty table", the RPC family answers one
 * 42501, and CLAUDE.md asks the reason for emptiness to be asserted rather
 * than inferred — so the feed now calls this gate too. Neither posture
 * leaked (league existence is discoverable through world-readable `teams`
 * either way); the point is that ONE shape answers one caller everywhere.
 *
 * **A SOFT-DELETED league is a 404 BY NAME, after membership (R812).**
 * `is_league_member` reads `league_members` alone and ignores
 * `leagues.deleted_at`, so a member of a deleted league passes the gate —
 * and the direct reads would then answer "the league row read empty after
 * membership passed" as a 500, while the write family (111/112/113) and
 * `league_standings` (117:1001) answer a missing/deleted league with P0002
 * → 404. The gate therefore reads the league row (`deleted_at IS NULL`)
 * AFTER the membership check and answers 404 when it is gone. Order is
 * load-bearing: a non-member of a deleted league still gets the 403 and
 * never learns the league existed.
 *
 * A transport error is a 500, never a `false` — rule 10's loud emptiness.
 *
 * No Date/random read here (the `src/lib/leagues/**` ESLint fences) — pure
 * plumbing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The one no-leak copy for every in-season READ refused on membership —
 *  a non-member and a nonexistent league read identically. */
export const INSEASON_READ_FORBIDDEN_MESSAGE =
  'Only members of this league can view it.'

/** The 404 for a member whose league has been soft-deleted (R812) — the
 *  READ family's sibling of the RPCs' P0002 `league … not found`. */
export const INSEASON_LEAGUE_GONE_MESSAGE = 'This league no longer exists.'

/**
 * Resolve to `null` when the caller is a member of a LIVE league, else the
 * `ServiceResult` the route should answer with: 403 on a `false` (non-member
 * and nonexistent league alike), 404 when the league is soft-deleted (only
 * a member can reach this arm), 500 on a transport error.
 */
export async function assertLeagueMember(
  supabase: Supabase,
  leagueId: string,
): Promise<ServiceResult | null> {
  const { data, error } = await supabase.rpc('is_league_member', { p_league_id: leagueId })
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  if (data !== true) {
    return { status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } }
  }
  // Membership passed, so the caller may learn the league is gone (R812).
  // The `leagues` SELECT policy is member/owner-only (052:126), so the row
  // is readable here; `.is('deleted_at', null)` is what hides a deleted one.
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (leagueError) {
    return { status: 500, body: { error: `leagues: ${leagueError.message}` } }
  }
  if (!league) {
    return { status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } }
  }
  return null
}

/**
 * PostgREST's default row cap (CLAUDE.md: "a query returning exactly 1000
 * rows looked like the whole table — it was PostgREST's cap"). Every
 * in-season read is bounded far below it by the league's own arithmetic
 * (≤ 16 teams × a roster; one week's matchups; one week's results), so a
 * result set that REACHES the cap is not a big league — it is a read that
 * cannot know whether it saw everything, and rule 10 says it must not
 * pretend to.
 */
export const POSTGREST_ROW_CAP = 1000

/** `null` when `rows` is provably complete; else the 500 the route answers
 *  with, naming the read that hit the cap. */
export function assertBelowPostgrestCap(rows: readonly unknown[], what: string): ServiceResult | null {
  if (rows.length >= POSTGREST_ROW_CAP) {
    return {
      status: 500,
      body: {
        error: `${what}: ${rows.length} rows reached the PostgREST cap — the result cannot be trusted as complete (page it before rendering)`,
      },
    }
  }
  return null
}
