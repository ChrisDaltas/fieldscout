'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LineupStarter, SetLineupResult } from '@/lib/leagues/api/lineup-service'
import { createBrowserClient } from '@/lib/supabase/client'

import { leagueRosterKeys } from './use-rosters'

/**
 * A team's weekly lineup — M4 task L.D4.1 (spec §15.3/§15.6/§11.2/§12.13;
 * migration 112's `set_lineup` as replaced by 114; PROGRESS D293/D308, the
 * contract is ledger row **F224(e)**).
 *
 * READ: an RLS-scoped direct SELECT of `team_lineups` (D92 — §15.3 prints NO
 * lineup GET; 112's F18 swap made the table member-truth SELECT with no
 * client write policy, so a member reads any team's row and nobody writes
 * one). A team is one league and one season, so `(team_id, week)` names the
 * row; a missing row is a real state (nothing set yet and the week not yet
 * opened by `league_week_advance`'s auto-carry — D293/D313) and renders as
 * `null`, while a transport error THROWS (CLAUDE.md's loud-emptiness rule).
 * `.maybeSingle()` also throws if two rows ever answer — a UNIQUE the
 * schema holds, asserted rather than assumed.
 *
 * WRITE: `PATCH /api/leagues/[id]/teams/[tid]/lineup` (§15.3 →
 * `set_lineup`). The client sends the FULL canonical `slot_map` including
 * IR keys (an absent IR key is a removal from IR; an empty slot is an
 * absent key — F224(e)), and **one `action_id` per submit, reused on
 * retry** (E2/D68(1), the `useAddDrop` shape): the exposed callbacks mint
 * the UUID and the mutation VARIABLES carry it, so a React Query retry
 * replays the same id and 112's `lineup_actions` ledger returns the stored
 * document byte-identically instead of writing twice. A second tap mints a
 * fresh id and is a genuinely new submit.
 *
 * **NEVER OPTIMISTIC — the UI shows the server's answer, not a guess.**
 * §15.6 lists "lineup set" among the optimistic updates and §11.2's lock law
 * is why this hook does not take that: every refusal a set can meet is about
 * state this client cannot evaluate — the per-player kickoff read from
 * `nfl_games` at transaction `now()` (E42), the bipartite fit (E16), the IR
 * stint, `allow_illegal_lineups` — and the SUCCESS is not the submitted map
 * either: 112 may RE-SEAT a placement (`rearranged` + `moved[]`) and returns
 * the canonical map. Rendering the submitted arrangement before the server
 * agrees would show a lineup that may never exist. So the cache is
 * invalidated on success and re-read; the mutation's `data` carries the
 * canonical document for the surface to render immediately (`slot_map`,
 * `starters[].flags`, `rearranged`/`moved[]`, `no_changes`, `locked_at` as
 * "locks at" — R779).
 *
 * The refusal reaches the caller as a `LeagueActionError` whose `message` is
 * the RPC's own copy, verbatim (F224(e)): the lock refusal names the player
 * and his kickoff and says every other unlocked slot stays editable. Render
 * it as-is; do not re-word it into "Something went wrong".
 *
 * A set also writes `league_rosters.slot_key`, so the rosters key (F233(b)'s
 * `leagueRosterKeys`) is invalidated with the lineup's.
 *
 * Entropy (the `action_id`) is minted HERE, in the hook, outside the
 * `src/lib/leagues/**` determinism fence (the D112(3)/D114(5) precedent).
 */

export const teamLineupKeys = {
  /** Every week of one team — the invalidation target. */
  all: (teamId: string) => ['team-lineup', teamId] as const,
  week: (teamId: string, week: number) => ['team-lineup', teamId, week] as const,
}

/** The `team_lineups` row as members read it (112's shape: `slot_map` is
 *  canonical incl. IR keys; `starters[]` carries the flags; `locked_at` is
 *  the RECORD of the earliest kickoff among the starters — "locks at" —
 *  never the decider). */
export interface TeamLineupRow {
  id: string
  team_id: string
  season: number
  week: number
  slot_map: Record<string, string>
  starters: LineupStarter[]
  bench: string[]
  locked_at: string | null
  edited_by_commish: boolean
  set_at: string | null
}

/** The stored lineup, or `null` when no row exists yet for the week. */
export function useLineup(teamId: string | undefined, week: number | undefined) {
  return useQuery({
    queryKey: teamLineupKeys.week(teamId ?? 'none', week ?? 0),
    enabled: Boolean(teamId) && week !== undefined,
    queryFn: async (): Promise<TeamLineupRow | null> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('team_lineups')
        .select('id, team_id, season, week, slot_map, starters, bench, locked_at, edited_by_commish, set_at')
        .eq('team_id', teamId!)
        .eq('week', week!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        ...data,
        slot_map: (data.slot_map ?? {}) as Record<string, string>,
        starters: (data.starters ?? []) as unknown as LineupStarter[],
        bench: (data.bench ?? []) as unknown as string[],
      }
    },
  })
}

export interface SetLineupInput {
  week: number
  /** The FULL canonical map incl. IR keys (F224(e)). */
  slotMap: Record<string, string>
  /** The commissioner arm's reason (R738/D290) — omit as the team's own
   *  manager; 112 refuses a non-manager actor without one (400, verbatim). */
  reason?: string | null
}

interface SetLineupVariables {
  week: number
  slot_map: Record<string, string>
  action_id: string
  reason?: string
}

export function useSetLineup(leagueId: string, teamId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (variables: SetLineupVariables) =>
      sendLeagueAction<SetLineupResult>(
        `/api/leagues/${leagueId}/teams/${teamId}/lineup`,
        jsonInit('PATCH', variables),
      ),
    onSuccess: (_result, variables) => {
      // The server's answer, re-read — never the submitted map (see the
      // header). The set also wrote `league_rosters.slot_key`.
      void queryClient.invalidateQueries({ queryKey: teamLineupKeys.week(teamId, variables.week) })
      void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    },
  })

  const variables = (input: SetLineupInput): SetLineupVariables => ({
    week: input.week,
    slot_map: input.slotMap,
    ...(input.reason ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a retry of THIS submit replays.
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: SetLineupInput) => mutation.mutate(variables(input)),
    submitAsync: (input: SetLineupInput) => mutation.mutateAsync(variables(input)),
  }
}
