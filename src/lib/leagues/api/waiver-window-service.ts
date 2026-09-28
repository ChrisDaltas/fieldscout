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
 * a hosted database that has not yet received migration 149 (no
 * `waiver_next_run_at`), a failed side read, or a schedule the TS twin
 * refuses all answer `{ window: null, error }` — the error NAMED, never an
 * empty window that would read as "free agency is closed" (CLAUDE.md "never
 * let nothing happened mean it worked"). The page then offers Add and Claim
 * both and the server answers.
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
}

export async function readWaiverWindow(
  supabase: Supabase,
  league: { id: string; season: number; status: string; waiver_next_run_at?: string | null },
  settings: LeagueSettings,
  at: Date,
): Promise<WaiverWindowRead> {
  if (!WAIVER_WINDOW_STATUSES.has(league.status)) {
    return { window: null, error: `no pickups while the league is ${league.status}` }
  }
  try {
    const [draftsRes, weeksRes, flagRes] = await Promise.all([
      supabase.from('drafts').select('completed_at').eq('league_id', league.id).eq('is_mock', false).eq('status', 'complete'),
      supabase.from('nfl_weeks').select('starts_at, last_game_ends_at').eq('season', league.season),
      supabase.from('system_flags').select('value').eq('key', 'waivers_paused').maybeSingle(),
    ])
    if (draftsRes.error) return { window: null, error: `drafts: ${draftsRes.error.message}` }
    if (weeksRes.error) return { window: null, error: `nfl_weeks: ${weeksRes.error.message}` }
    if (flagRes.error) return { window: null, error: `system_flags: ${flagRes.error.message}` }
    const flag = (flagRes.data?.value ?? null) as { paused?: unknown } | null
    const window = waiverWindowView({
      settings,
      draftCompletedAt: (draftsRes.data ?? []).map((d) => d.completed_at),
      weeks: weeksRes.data ?? [],
      // Absent on a pre-149 row (the column does not exist yet): untracked.
      pendingRunAt: league.waiver_next_run_at ?? null,
      // 150's tick reads `(value ->> 'paused')::boolean`, so a stored "true" pauses too.
      paused: flag?.paused === true || flag?.paused === 'true',
      at,
    })
    return { window, error: null }
  } catch (cause) {
    return { window: null, error: `waiver window: ${(cause as Error).message}` }
  }
}
