'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'

import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { leaguesKeys } from './use-leagues'
import { leagueRosterKeys } from './use-rosters'

/**
 * The add/drop verb — M4 task L.D4.2 (spec §15.3/§13.1; migration 113's
 * `roster_add_drop`; the contract is PROGRESS ledger row **F227(f)**).
 *
 * WRITE ONLY, on purpose. The transactions TABLE is read through the
 * activity feed (`use-league-activity.ts`) — one read of `transactions` in
 * the app, not two that can disagree — so this file is the mutation and its
 * idempotency stamp, nothing else.
 *
 * **One `action_id` per submit, reused on retry** (E2/D68(1), the
 * `useMakePick` shape): the exposed callbacks mint the UUID and the mutation
 * VARIABLES carry it, so a React Query retry replays the same id and 113
 * returns the stored payload byte-identically instead of making a second
 * move. A double-tap mints a fresh id per tap and is a genuinely new move —
 * which is correct: two taps on "Add" are two intentions.
 *
 * **Never optimistic** (§15.6). A roster move is server-authoritative and
 * every refusal is about state this client cannot evaluate — exclusivity,
 * the E32 kickoff lock, waiver state, caps, capacity. Showing the player on
 * the roster before the server agrees would be a lie roughly as often as the
 * league is contested. The response is the truth; the feed is the record.
 *
 * The refusal reaches the caller as a `LeagueActionError` whose `message` is
 * the RPC's own copy, verbatim (F227(f)) — the E32 message names the kickoff
 * and when the week clears, the waiver message names `waivers_until`, the
 * cap message names used/cap/week. Render it as-is; do not re-word it into
 * "Something went wrong".
 */

export interface AddDropInput {
  teamId: string
  /** Either side may be null — never both (400 with a field error). */
  addPlayerId?: string | null
  dropPlayerId?: string | null
}

interface AddDropVariables {
  team_id: string
  add_player_id?: string | null
  drop_player_id?: string | null
  action_id: string
}

/** 113's result — the stored `transactions.payload`, returned whole. The
 *  fields F227(f) names as the route's rendering duty are called out; the
 *  rest of the document rides along untouched. */
export interface AddDropResult {
  transaction_id: string
  action_id: string
  league_id: string
  team_id: string
  season: number
  week: number
  type: 'add_drop'
  add_player_id: string | null
  drop_player_id: string | null
  add: {
    player_id: string
    name: string | null
    position: string | null
    nfl_team: string | null
    from_state: string
    to_state: string
    acquisition_type: string
    slot_key: string
    acquired_at: string
    game_lock: Record<string, unknown>
  } | null
  drop: {
    player_id: string
    name: string | null
    position: string | null
    nfl_team: string | null
    from_slot_key: string | null
    to_state: string
    waivers_until: string | null
    fa_hold: {
      hours: number
      acquisition_type: string | null
      acquired_at: string | null
      early: boolean
    }
    /** F227(f): the lineups the drop touched. Entries are `{week, slot}` and
     *  ONLY that — `slot: null` marks a bench-only touch (R758). There is no
     *  `kept_in_locked_lineup` key: the Q32 application deleted it, and a
     *  dropped player's slot ALWAYS clears (R760). */
    lineups: Array<{ week: number; slot: string | null }>
    game_lock: Record<string, unknown>
  } | null
  roster: { count_after: number; roster_size: number }
  /** F227(f): `used_*_after` are real numbers on EVERY move since R763's
   *  hoist — a drop-only reports the unchanged totals, never NULL — so a
   *  surface may render "used 2 of 3" without a null guard producing
   *  "null of 3". `acquisitions_per_*` is the cap or the string
   *  `'unlimited'`. */
  caps: {
    acquisitions_per_week: string
    acquisitions_per_season: string
    used_week_after: number
    used_season_after: number
  }
  settings: Record<string, unknown>
  evaluated_at: string
}

export function useAddDrop(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (variables: AddDropVariables) =>
      sendLeagueAction<AddDropResult>(
        `/api/leagues/${leagueId}/transactions`,
        jsonInit('POST', variables),
      ),
    onSuccess: () => {
      // The move is in the feed and it changed the league's rosters. The
      // ROSTERS query key is L.D4.1's (`use-rosters.ts`) — PROGRESS
      // **F233(b)**: added here by L.D4.1 rather than invented by L.D4.2, so
      // a completed move refreshes the roster it changed. The POOL key is
      // L.D5.4's (`use-league-pool.ts`): the same move flipped a pool row
      // (rostered ↔ free_agent / on_waivers — D294's mirror).
      void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
    },
    onError: () => {
      // A refusal re-reads (the D316(10a) posture, L.D5.4): every refusal a
      // move can meet is about state this client rendered from a VIEW —
      // the tick's lock, a pool row, a roster — that the server just judged
      // stale or wrong. Re-reading is how the server's answer reaches the
      // screen; the refusal text itself stays on screen verbatim.
      void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
    },
  })

  return {
    ...mutation,
    /** One action_id per submit (D68(1)); a retry of THIS submit replays. */
    submit: (input: AddDropInput) =>
      mutation.mutate({
        team_id: input.teamId,
        add_player_id: input.addPlayerId ?? null,
        drop_player_id: input.dropPlayerId ?? null,
        action_id: crypto.randomUUID(),
      }),
    submitAsync: (input: AddDropInput) =>
      mutation.mutateAsync({
        team_id: input.teamId,
        add_player_id: input.addPlayerId ?? null,
        drop_player_id: input.dropPlayerId ?? null,
        action_id: crypto.randomUUID(),
      }),
  }
}
