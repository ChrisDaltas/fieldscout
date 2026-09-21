/**
 * The MANAGER's own team rename — M6A task L.E1.13,
 * `POST /api/leagues/[id]/teams/[tid]/name` → `rename_own_team` (migration
 * 128 §4; tasks-M6A §6 L.E1.7 item 2 / L.E1.13 item 2; PROGRESS D359, F338).
 *
 * **THIS IS NOT A COMMISSIONER DOOR**, which is why it does not live under
 * `/commish/` (L.E1.11's AS-BUILT note (ii)). A manager renaming his OWN
 * franchise exercises no §10.1 power, so 128 gives the verb NONE of the
 * commissioner apparatus, and this layer adds none back: NO reason, NO
 * `commissioner_actions` receipt, NO §10.3 post, NO `action_id` and NO
 * replay ledger — setting a name to a value is idempotent by construction
 * (128:659-693). The verb REPORTS each absence in its document (`audited:
 * false` + `audited_why`, `system_post: null` + `system_post_why`), and the
 * document is returned whole. The commissioner's rename of ANY team is
 * `commish-team-service.ts` (audited, replay-keyed) and is mounted inside
 * override mode; this one is not.
 *
 * **Authorization is the verb's** — ONE no-leak 42501 ("not the manager of
 * this team") for a team that does not exist, a team that is not his, and a
 * caller who is nobody. The refusals that are about the FRANCHISE (a retired
 * franchise's name is frozen — `spec:183`, a legality gate that binds
 * everyone; a standalone team is routed to its own door) are P0001 → 409
 * with 128's sentence VERBATIM.
 *
 * **The league in the URL is checked, because the verb does not take one.**
 * `rename_own_team(p_team_id, p_name)` resolves the league from the team, so
 * a request naming league A and a team of league B would otherwise LAND on
 * B's franchise under A's URL. One member-RLS read of `teams.league_id`
 * refuses that as the route family's 404 BEFORE the write. A PostgREST error
 * on that read is a 500 with the driver's message — never "team not found"
 * (CLAUDE.md: never let a failed read look like an empty one).
 *
 * The name bound is 128's own (`team_rename_normalize_internal`: trimmed,
 * non-empty, ≤ 100), mirrored as a field error so the form can route it; JS
 * `trim()` strips a superset of 128's class, so the wire value is a fixed
 * point of 128's trim and `requested_name === name` on every landed call —
 * the identity line below (D364(4)'s argument, the manager's arm).
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**`
 * ESLint fences): the instant is the database's `now()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy — one no-leak string; it names the other door. */
export const RENAME_OWN_TEAM_FORBIDDEN_MESSAGE =
  'Only a team’s own manager can rename it here. The commissioner renames any team from the team page in override mode.'

/** The 404 for a team that is not a franchise of the league in the URL. */
export const RENAME_OWN_TEAM_NOT_IN_LEAGUE_MESSAGE = 'Team not found in this league.'

/** The 500 for a document that is not the rename that was asked for. */
export const RENAME_OWN_TEAM_UNCONFIRMED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the rename you just submitted. Check the team’s name and try again.'

export const renameOwnTeamInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
})
export type RenameOwnTeamInput = z.infer<typeof renameOwnTeamInputSchema>

/** 128's result document (`128:838-855`), returned whole. */
export interface RenameOwnTeamResult {
  verb: 'rename_own_team'
  team_id: string
  league_id: string
  /** The name the franchise carries AFTER this call (the old one on a no-op). */
  name: string
  previous_name: string
  requested_name: string
  /** Teams in this league already carrying the same name (case-folded) —
   *  MEASURED, never a refusal. */
  name_collides_with: unknown
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  audited: false
  audited_why: string
  system_post: null
  system_post_why: string
  evaluated_at: string
}

interface ResultShape {
  verb?: unknown
  team_id?: unknown
  requested_name?: unknown
}

export async function renameOwnTeam(
  supabase: Supabase,
  leagueId: string,
  teamId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = renameOwnTeamInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { name } = parsed.data

  // The URL's league, checked BEFORE the write (see the header). RLS-empty
  // and "another league's team" are the same no-leak 404.
  const team = await supabase.from('teams').select('league_id').eq('id', teamId).maybeSingle()
  if (team.error) {
    return { status: 500, body: { error: team.error.message } }
  }
  if (!team.data || team.data.league_id !== leagueId) {
    return { status: 404, body: { error: RENAME_OWN_TEAM_NOT_IN_LEAGUE_MESSAGE } }
  }

  const { data, error } = await supabase.rpc('rename_own_team', { p_team_id: teamId, p_name: name })
  if (error) {
    return mapInSeasonRpcError(error, RENAME_OWN_TEAM_FORBIDDEN_MESSAGE)
  }

  // Never let "nothing came back" mean "it worked": the document must be
  // THIS verb's, for THIS team, for THIS name.
  const result = (data ?? {}) as ResultShape
  if (result.verb !== 'rename_own_team' || result.team_id !== teamId || result.requested_name !== name) {
    return { status: 500, body: { error: RENAME_OWN_TEAM_UNCONFIRMED_MESSAGE } }
  }
  return { status: 200, body: data as unknown as Json }
}
