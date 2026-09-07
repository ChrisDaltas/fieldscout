'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import { createBrowserClient } from '@/lib/supabase/client'
import { mintScheduleSeed } from '@/lib/leagues/settings/league-settings'

import { leagueActivityKeys } from './use-league-activity'
import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, scheduleEventInvalidates } from './use-league-channel-ops'
import { leaguesKeys } from './use-leagues'

/**
 * The season schedule + Remix — M4 task L.D4.2 (spec §15.3/§11.7; migration
 * 111's `schedule_preview` / `schedule_remix_confirm`; PROGRESS
 * D289/D290/D307).
 *
 * READ: an RLS-scoped direct SELECT (D92 — §15.3 prints NO schedule GET on
 * purpose; `matchups` and `league_weeks` are both member-SELECTable,
 * 109:259-ish and 056:78). One query returns the pairing grid and the week
 * ladder together because the schedule page renders them as one thing: a
 * week's row is only meaningful beside its `league_weeks.status` (an
 * `upcoming` week can be remixed; a `live`/`final` one is frozen).
 *
 * WRITE: the two §15.3 routes. **The client sends a SEED, never a
 * SCHEDULE** — see `schedule-service.ts`'s header for the law; the hook
 * half of it is that `remix()` mints a seed, holds it, and `confirm()` sends
 * THAT seed back. Nothing derived from the preview (the proposed pairings,
 * the diff, the week list) is ever posted: 111 regenerates all of it in-body
 * from the seed at confirm time.
 *
 * ENTROPY IS INJECTED AT THE GESTURE, here in the hook — outside the
 * `src/lib/leagues/**` determinism fence (the D112(3) precedent for
 * randomize, D114(5) for route-minted action ids). `mintScheduleSeed` is the
 * catalog's own pure mint (`uuid → 31-bit`), so the seed the wire carries is
 * always inside §11.7's space and the settings schema accepts it unchanged.
 *
 * NEVER OPTIMISTIC (§15.6): a Remix rewrites the league's season. The
 * confirm's response — and the D97 system post it wrote — is the truth.
 */

export const scheduleKeys = {
  all: (leagueId: string) => ['league-schedule', leagueId] as const,
}

export interface ScheduleWeek {
  id: string
  season: number
  week: number
  status: string
  finalized_at: string | null
  median_score: number | null
}

/** The `matchups` columns this hook selects — `matchups-service.ts`'s row
 *  type minus `updated_at`, which the schedule grid does not read (R813:
 *  one hand-typed row for the table, not two). */
export type ScheduleMatchup = Omit<MatchupRow, 'updated_at'>

export interface LeagueSchedule {
  weeks: ScheduleWeek[]
  matchups: ScheduleMatchup[]
}

/** The league's whole season: the week ladder + every pairing, member-RLS.
 *  A non-member reads nothing and gets two empty arrays — the
 *  empty-for-a-non-member shape the in-season family refuses at its routes
 *  (R807/R808; PROGRESS F249(a)). **The SURFACE is the gate, by decision
 *  (L.D5.3, the D316(4) posture `useLineup` took):** every page that mounts
 *  this hook (`schedule-view.tsx`, `team-page.tsx`) sits below `useLeague`'s
 *  403/404, and the `leagues` SELECT policy (052:126) is member/owner-only,
 *  so the hook cannot mount for a non-member in the UI at no extra round
 *  trip on the member path; a future consumer mounting it outside a league
 *  page inherits the hazard and F249's one-line cure (a browser-side
 *  `is_league_member` RPC before the read). A transport error THROWS rather
 *  than rendering as an empty season (CLAUDE.md's loud-emptiness rule). */
export function useSchedule(leagueId: string | undefined) {
  return useQuery({
    queryKey: scheduleKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<LeagueSchedule> => {
      const supabase = createBrowserClient()
      const [weeksRes, matchupsRes] = await Promise.all([
        supabase
          .from('league_weeks')
          .select('id, season, week, status, finalized_at, median_score')
          .eq('league_id', leagueId!)
          .order('season', { ascending: true })
          .order('week', { ascending: true }),
        supabase
          .from('matchups')
          .select(
            'id, season, week, round_type, status, home_team_id, away_team_id, home_score, away_score, result, is_overridden',
          )
          .eq('league_id', leagueId!)
          .order('week', { ascending: true })
          .order('round_type', { ascending: true })
          .order('id', { ascending: true }),
      ])
      if (weeksRes.error) throw weeksRes.error
      if (matchupsRes.error) throw matchupsRes.error
      return {
        weeks: (weeksRes.data ?? []) as ScheduleWeek[],
        matchups: (matchupsRes.data ?? []) as ScheduleMatchup[],
      }
    },
  })
}

/**
 * The fetch + subscribe half — what the mounted schedule page uses (M4 task
 * L.D5.3; D298: freshness is broadcast + refetch-on-event). Joins the ONE
 * `league:<id>` room (F233(a) — a handler map, never a `.channel(`) and
 * refetches on the events `scheduleEventInvalidates` admits: `matchups` (119's
 * per-statement trigger — a score tick, a status flip, and a Remix's or a
 * bracket (re)build's DELETE + INSERT, one event each) and `league_weeks`.
 * The `league_chat` stand-in (the one carrier a Remix had before 119 — 111's
 * D97 post in the same transaction) retired with the trigger (F254(a)).
 * Every confirmed (re)join refetches (§9.3). Returns the spine's
 * `connection` for the §16.5.4 reconnecting banner.
 */
export function useScheduleLive(leagueId: string | undefined) {
  const query = useSchedule(leagueId)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.all(leagueId) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    invalidatingHandlers(scheduleEventInvalidates, invalidate),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}

/** One row of 111's `proposed` set — the WHOLE regular season for the seed,
 *  `regenerated` marking the rows a confirm would actually write. */
export interface RemixProposedRow {
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
  regenerated: boolean
}

/** One line of 111's human diff — one row per (week, game type, team) whose
 *  opponent or side changed; `text` is the server's sentence. */
export interface RemixDiffLine {
  week: number
  round_type: string
  team_id: string
  team_name: string
  old_opponent_id: string
  old_opponent_name: string
  new_opponent_id: string
  new_opponent_name: string
  old_side: string
  new_side: string
  text: string
}

/** A week 111 froze, with the reason it names (`week_live` / `week_final` /
 *  `week_correction_window` / `week_kicked_off` / `matchup_not_scheduled` /
 *  `matchup_overridden_or_scored` — D307(1)). */
export interface RemixFrozenWeek {
  week: number
  week_status: string
  reason: string
}

/** 111's plan document, as the Remix modal renders it. */
export interface RemixPreview {
  league_id: string
  season: number
  seed: number
  current_seed: number | null
  first_week: number
  last_regular_week: number
  regular_season_weeks: number
  second_opponent: boolean
  team_count: number
  /** E41: `free` before the league's first kickoff — `reason_required` is
   *  the modal's gate, evaluated server-side at call time, never here. */
  window: {
    evaluated_at: string
    first_kickoff_at: string | null
    datum_arm: string
    free: boolean
    reason_required: boolean
  }
  weeks_regenerable: number[]
  /** Frozen weeks come back with the REASON each is frozen — render it. */
  weeks_frozen: RemixFrozenWeek[]
  matchups_current: number
  matchups_regenerable: number
  proposed: RemixProposedRow[]
  /** The human diff ("Week 1: T1 now plays T6 instead of T3"). */
  diff: RemixDiffLine[]
  change_count: number
  no_changes: boolean
}

export interface RemixConfirmResult {
  league_id: string
  season: number
  action_id: string
  schedule_seed: number
  previous_seed: number | null
  first_week: number
  regular_season_weeks: number
  window: RemixPreview['window']
  reason_required: boolean
  weeks_regenerated: number[]
  weeks_frozen: RemixFrozenWeek[]
  matchups_replaced: number
  change_count: number
  no_changes: boolean
  diff: RemixDiffLine[]
  /** The D97 system post's text, exactly as it was written to league chat. */
  system_post: string
}

/**
 * POST …/schedule/remix — preview a new seed (write-free).
 *
 * `preview()` mints the seed; `previewSeed(seed)` re-previews one the caller
 * already holds (a modal re-open, or a retry after a transport error) so the
 * commissioner sees the SAME proposal rather than a new roll.
 */
export function useRemixPreview(leagueId: string) {
  const mutation = useMutation({
    mutationFn: (variables: { seed: number }) =>
      sendLeagueAction<RemixPreview>(
        `/api/leagues/${leagueId}/schedule/remix`,
        jsonInit('POST', variables),
      ),
  })

  return {
    ...mutation,
    preview: () => mutation.mutate({ seed: mintScheduleSeed(crypto.randomUUID()) }),
    previewAsync: () => mutation.mutateAsync({ seed: mintScheduleSeed(crypto.randomUUID()) }),
    previewSeed: (seed: number) => mutation.mutate({ seed }),
    previewSeedAsync: (seed: number) => mutation.mutateAsync({ seed }),
  }
}

export interface ConfirmRemixInput {
  /** The PREVIEWED seed — the only thing carried across the round trip. */
  seed: number
  /** Required by 111 outside E41's free window; the refusal names it. */
  reason?: string | null
}

/**
 * POST …/schedule/confirm — apply the previewed remix.
 *
 * One `action_id` per submit (E2/D68(1)): 111's `schedule_actions` ledger
 * replays it and returns the stored result byte-identically, even after a
 * later Remix has replaced every row the first one wrote. No code path
 * re-sends an id on its own — `useMutation` sets no `retry` (the provider's
 * `retry: 1` is under `queries`) and `confirm`/`confirmAsync` mint per call;
 * a caller re-invoking `mutate` with the same variables replays (F249(b),
 * R815's correction read into this file). A second Remix is a second
 * gesture and mints a new id.
 */
export function useConfirmRemix(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (variables: { seed: number; reason?: string | null; action_id: string }) =>
      sendLeagueAction<RemixConfirmResult>(
        `/api/leagues/${leagueId}/schedule/confirm`,
        jsonInit('POST', variables),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all(leagueId) })
      // The confirm wrote a D97 system post — it belongs in the feed now.
      void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
      // …and it re-minted `settings.schedule_seed` on the league row.
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    },
  })

  return {
    ...mutation,
    confirm: (input: ConfirmRemixInput) =>
      mutation.mutate({
        seed: input.seed,
        ...(input.reason ? { reason: input.reason } : {}),
        action_id: crypto.randomUUID(),
      }),
    confirmAsync: (input: ConfirmRemixInput) =>
      mutation.mutateAsync({
        seed: input.seed,
        ...(input.reason ? { reason: input.reason } : {}),
        action_id: crypto.randomUUID(),
      }),
  }
}

/** 111's edit result, as the schedule view renders it. */
export interface EditMatchupResult {
  league_id: string
  season: number
  action_id: string
  week: number
  round_type: string
  matchup: {
    matchup_id: string
    before: { home_team_id: string; away_team_id: string }
    after: { home_team_id: string; away_team_id: string }
  }
  /** The sibling rows 111 re-seated to keep every team once per week. */
  siblings: Array<{
    matchup_id: string
    vacated_sides: string[]
    before: { home_team_id: string; away_team_id: string }
    after: { home_team_id: string; away_team_id: string }
  }>
  rows_changed: number
  reason_required: boolean
  window: RemixPreview['window']
  /** The D97 system post's text, exactly as it was written to league chat. */
  system_post: string
}

export interface EditMatchupInput {
  matchup_id: string
  home_team_id: string
  away_team_id: string
  /** Required by 111 outside E41's free window; the refusal names it. */
  reason?: string | null
}

/**
 * POST …/schedule/matchup — re-pair one scheduled matchup (§11.7's manual
 * edit; M4 task L.D5.3, F233(e)).
 *
 * One `action_id` per submit, minted here at the gesture (outside the
 * `src/lib/leagues/**` fence — the D112(3)/D114(5) precedent); a caller
 * re-invoking `mutate` with the same variables replays, and nothing re-sends
 * an id on its own (F249(b)). NEVER OPTIMISTIC: 111 re-seats the displaced
 * teams itself, so the rows on screen after an edit are the server's — the
 * hook invalidates the schedule and re-reads. The confirm wrote a D97 system
 * post, so the feed is invalidated too.
 */
export function useEditMatchup(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (variables: EditMatchupInput & { action_id: string }) =>
      sendLeagueAction<EditMatchupResult>(
        `/api/leagues/${leagueId}/schedule/matchup`,
        jsonInit('POST', variables),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    },
  })

  const variables = (input: EditMatchupInput) => ({
    matchup_id: input.matchup_id,
    home_team_id: input.home_team_id,
    away_team_id: input.away_team_id,
    ...(input.reason ? { reason: input.reason } : {}),
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    edit: (input: EditMatchupInput) => mutation.mutate(variables(input)),
    editAsync: (input: EditMatchupInput) => mutation.mutateAsync(variables(input)),
  }
}
