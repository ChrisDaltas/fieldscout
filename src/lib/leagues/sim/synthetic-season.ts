/**
 * A SYNTHETIC NFL season for every fixture that completes a REAL draft
 * (PROGRESS F215; migration 110 / spec §11.7 Mid-season entry).
 *
 * WHY. From migration 110, completing a non-mock draft maps the league's
 * first week onto `nfl_weeks` AT THE CALL INSTANT (Q29: "the next NFL week
 * whose first kickoff is still ahead") and shrinks-or-refuses the plan to
 * end by week 18 (Q31). A fixture league created on the REAL 2026 calendar
 * therefore drifts with the wall clock: week 2 from 2026-09-09, a silent
 * shrink from week 3, a refusal from NFL week 16 (2027-01-06) — a suite
 * green today and red by calendar is CLAUDE.md's "nothing happened means it
 * worked" with a fuse. Leagues created on `SYNTHETIC_SEASON` map to week 1
 * at any wall clock before the year 2099: the calendar belongs to the
 * fixture, not the clock.
 *
 * WHO. Every stack suite that STARTS or completes a real draft — eighteen
 * `*-db.test.ts` files after the #251 fix round (R724: draft START is
 * calendar-bound too), the schedule property sweep, the League Simulator
 * (runner.ts) and the e2e provisioner (e2e/helpers/provision.ts) — creates
 * its leagues on this season after seeding it. The authoritative list is
 * `grep -l SYNTHETIC_SEASON src e2e scripts`; PROGRESS F215 records the
 * two measurements that produced it (R729).
 *
 * SEEDING IS IDEMPOTENT AND IS NOT CLEANED. `upsert … ignoreDuplicates`
 * makes a second seed a no-op, and the 18 rows are left in place on
 * purpose: parallel suites share one stack, a DELETE would race another
 * suite's league_weeks rows (FK 056:70) and the rows are reference data on
 * a season no real league will ever be created for. The real 2026 rows are
 * never touched (pgTAP 003 pins them).
 *
 * TIME. No clock is read here (the M0 fence): every instant is a literal
 * derived from the season year — the 039 derivation shape (Wednesday 00:00
 * ET before the week's first game; correction window = the following
 * Thursday 06:00 ET), with the EDT offset kept for all 18 weeks (the
 * synthetic season only needs ordering + the "kickoff still ahead" datum,
 * never DST fidelity).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/** The season every draft-completing fixture creates its leagues on. */
export const SYNTHETIC_SEASON = 2099

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export interface SyntheticNflWeek {
  season: number
  week: number
  starts_at: string
  first_kickoff_at: null
  last_game_ends_at: null
  correction_window_ends_at: string
}

/** The 18 `nfl_weeks` rows of a synthetic season (pure — no I/O, no clock). */
export function syntheticNflWeeks(season: number = SYNTHETIC_SEASON): SyntheticNflWeek[] {
  // Week 1 starts Wednesday <season>-09-09 00:00 ET (-04) = 04:00Z — the
  // 2026 opener's calendar shape (039), re-used for any season year.
  const week1StartMs = Date.UTC(season, 8, 9, 4, 0, 0)
  return Array.from({ length: 18 }, (_, i) => {
    const startMs = week1StartMs + i * 7 * DAY_MS
    // Following Thursday 06:00 ET (-04) = 10:00Z, eight days after the start.
    const windowEndMs = startMs + 8 * DAY_MS + 6 * HOUR_MS
    return {
      season,
      week: i + 1,
      starts_at: new Date(startMs).toISOString(),
      first_kickoff_at: null,
      last_game_ends_at: null,
      correction_window_ends_at: new Date(windowEndMs).toISOString(),
    }
  })
}

/**
 * Seed the synthetic season into `nfl_weeks` (service role — the table has
 * no client write policy). Idempotent; never deletes (see the header).
 */
export async function seedSyntheticSeason(
  service: SupabaseClient<Database>,
  season: number = SYNTHETIC_SEASON,
): Promise<void> {
  const { error } = await service
    .from('nfl_weeks')
    .upsert(syntheticNflWeeks(season), { onConflict: 'season,week', ignoreDuplicates: true })
  if (error) throw new Error(`seedSyntheticSeason(${season}): ${error.message}`)
}
