/**
 * The league detail's `waiver_window` read — M5 task L.D2.13 (PROGRESS F425;
 * the arithmetic and why it is TS: `waiver-window-view.ts`).
 *
 * Four member-readable facts over the caller's own client (RLS): the league
 * row (already read by the detail — its schedule and `waiver_next_run_at`),
 * the league's completed non-mock drafts, the season's `nfl_weeks`, and the
 * world-readable `system_flags.waivers_paused`.
 *
 * NEVER FAILS THE DETAIL. The detail is every league page's membership gate;
 * a failed side read or a schedule the TS twin refuses answers `{ window:
 * null, error }` — the error NAMED, never an empty window that would read as
 * "free agency is closed" (CLAUDE.md "never let nothing happened mean it
 * worked"). The page then offers Add and Claim both and the server answers.
 *
 * PRE-149 DATABASE (R1219). A league row WITHOUT the `waiver_next_run_at`
 * key is a database that has not received the schedule (149) — nor, since
 * 149 follows it, the claims (145). There the server enforces no window and
 * has no claim verb, so computing one would disable pickups the server
 * allows and offer claims it cannot take: the read answers `{ window: null,
 * live: false }` and the page hides Claim and the claims panel (Add is the
 * old behaviour).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { waiverWindowView, type WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'
import type { Database } from '@/types/database'

type Supabase = SupabaseClient<Database>

/** Statuses in which pickups exist at all (before the draft there is no pool to pick from). */
export const WAIVER_WINDOW_STATUSES = new Set(['drafting', 'in_season', 'playoffs'])

export interface WaiverWindowRead {
  window: WaiverWindowView | null
  /** Why `window` is null (a status with no pickups, or the read that failed). */
  error: string | null
  /** False on a database without the waiver schedule / claims (pre-149, R1219). */
  live: boolean
}

export const PRE_149_ERROR = 'schedule not live on this database (pre-149)'

export async function readWaiverWindow(
  supabase: Supabase,
  league: { id: string; season: number; status: string; waiver_next_run_at?: string | null },
  settings: LeagueSettings,
  at: Date,
): Promise<WaiverWindowRead> {
  if (!Object.prototype.hasOwnProperty.call(league, 'waiver_next_run_at')) {
    return { window: null, error: PRE_149_ERROR, live: false }
  }
  if (!WAIVER_WINDOW_STATUSES.has(league.status)) {
    return { window: null, error: `no pickups while the league is ${league.status}`, live: true }
  }
  try {
    const [draftsRes, weeksRes, flagRes] = await Promise.all([
      supabase.from('drafts').select('completed_at').eq('league_id', league.id).eq('is_mock', false).eq('status', 'complete'),
      supabase.from('nfl_weeks').select('starts_at, last_game_ends_at').eq('season', league.season),
      supabase.from('system_flags').select('value').eq('key', 'waivers_paused').maybeSingle(),
    ])
    if (draftsRes.error) return { window: null, error: `drafts: ${draftsRes.error.message}`, live: true }
    if (weeksRes.error) return { window: null, error: `nfl_weeks: ${weeksRes.error.message}`, live: true }
    if (flagRes.error) return { window: null, error: `system_flags: ${flagRes.error.message}`, live: true }
    const flag = (flagRes.data?.value ?? null) as { paused?: unknown } | null
    const window = waiverWindowView({
      settings,
      draftCompletedAt: (draftsRes.data ?? []).map((d) => d.completed_at),
      weeks: weeksRes.data ?? [],
      // NULL = the processor does not track the league yet (the key exists — checked above).
      pendingRunAt: league.waiver_next_run_at ?? null,
      paused: pausedFlag(flag?.paused),
      at,
    })
    return { window, error: null, live: true }
  } catch (cause) {
    return { window: null, error: `waiver window: ${(cause as Error).message}`, live: true }
  }
}

/** 150's tick reads `(value ->> 'paused')::boolean` — so every Postgres true
 *  spelling pauses (R1223): t / true / yes / y / on / 1, any case. */
export function pausedFlag(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  return ['t', 'true', 'yes', 'y', 'on', '1'].includes(value.trim().toLowerCase())
}
