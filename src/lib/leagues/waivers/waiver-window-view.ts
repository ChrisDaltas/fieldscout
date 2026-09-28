/**
 * The league's waiver WINDOW as the app displays it — M5 task L.D2.13
 * (PROGRESS F425: "a read of `waiver_window_internal` (league-level: open /
 * why / next run)"; spec §7.3.4 / §13.1 v2.16.59, §16.5.2's Waivers row).
 *
 * WHY A TS READ AND NOT THE SQL ONE. Migration 153's `waiver_window_internal`
 * is REVOKEd from `authenticated` and no definer wrapper exposes it; adding one
 * is a migration, which this ONE-PASS UI task may not write. The window's
 * arithmetic already has a TS twin pinned to the SAME literals as the SQL
 * (`freeAgencyWindow`, `waiver-schedule.ts`, D388(5)), and the week's end is
 * the lock release — `LEAST(last_game_ends_at, the Wednesday 00:00 Pacific
 * ceiling)` (153 `week_lock_release_internal`) — whose ceiling also has its
 * pinned twin (`weekReleaseCeiling`). So the server composes the same four
 * facts the SQL reads (the schedule, the draft's completion, the weeks' lock
 * releases, `leagues.waiver_next_run_at`) and hands the answer to the page.
 *
 * DISPLAY ONLY. Nothing is refused or allowed on this answer: the add path
 * and the claim verb decide under the league row lock and say why by name,
 * and the page renders that sentence verbatim. At worst this read is one tick
 * (a minute) behind the processor.
 *
 * PURE — the instant is an argument (`at`, the route's TimeProvider); no
 * clock is read (the D3 fence over `src/lib/leagues/**`).
 */
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { weekReleaseCeiling } from '@/lib/leagues/time/release-floor'
import { freeAgencyWindow, type WindowWhy } from '@/lib/leagues/time/waiver-schedule'

/** What the league detail carries as `waiver_window` (null = the read failed
 *  or the league predates the schedule — the page then shows Add and Claim
 *  both and lets the server answer). */
export interface WaiverWindowView {
  /** False under `none_fcfs` ("no waivers"). */
  waivers: boolean
  free_agency_open: boolean
  why: WindowWhy
  /** The next scheduled run strictly after `evaluated_at` — where a claim settles. */
  next_run_at: string | null
  /** The latest run that counts (processed, or scheduled when untracked). */
  last_run_at: string | null
  /** day_and_time only: the latest weekly opening at or before `evaluated_at`. */
  last_open_at: string | null
  /** The league's schedule zone (IANA). */
  time_zone: string
  /** `system_flags.waivers_paused` — an operator stopped every run. */
  paused: boolean
  /** The server instant the window was read at (the page's only "now"). */
  evaluated_at: string
}

export interface WaiverWindowInputs {
  settings: Pick<
    LeagueSettings,
    | 'waiver_type'
    | 'waiver_run_days'
    | 'waiver_run_time'
    | 'waiver_time_zone'
    | 'free_agency_opens'
    | 'free_agency_open_day'
    | 'free_agency_open_time'
  >
  /** `completed_at` of the league's non-mock drafts with status `complete`. */
  draftCompletedAt: readonly (string | null)[]
  /** The league season's `nfl_weeks` rows. */
  weeks: readonly { last_game_ends_at: string | null; starts_at: string }[]
  /** `leagues.waiver_next_run_at` (absent before migration 149 — pass null). */
  pendingRunAt: string | null
  paused: boolean
  at: Date
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** 153's `week_lock_release_internal`: the recorded end, capped by the ceiling. */
export function weekLockRelease(week: { last_game_ends_at: string | null; starts_at: string }): number {
  const ceiling = weekReleaseCeiling(week.starts_at).getTime()
  const recorded = ms(week.last_game_ends_at)
  return recorded === null ? ceiling : Math.min(recorded, ceiling)
}

/**
 * 153's reset instant: the latest of the draft completing and any week's lock
 * release, neither after `at` (null when neither has happened).
 */
export function windowResetAt(inputs: Pick<WaiverWindowInputs, 'draftCompletedAt' | 'weeks' | 'at'>): Date | null {
  const at = inputs.at.getTime()
  let best: number | null = null
  for (const d of inputs.draftCompletedAt) {
    const t = ms(d)
    if (t !== null && t <= at && (best === null || t > best)) best = t
  }
  for (const w of inputs.weeks) {
    const t = weekLockRelease(w)
    if (t <= at && (best === null || t > best)) best = t
  }
  return best === null ? null : new Date(best)
}

export function waiverWindowView(inputs: WaiverWindowInputs): WaiverWindowView {
  const s = inputs.settings
  const state = freeAgencyWindow({
    schedule: {
      waiver_run_days: [...s.waiver_run_days],
      waiver_run_time: s.waiver_run_time,
      waiver_time_zone: s.waiver_time_zone,
      free_agency_opens: s.free_agency_opens,
      free_agency_open_day: s.free_agency_open_day,
      free_agency_open_time: s.free_agency_open_time,
    },
    waiverType: s.waiver_type,
    resetAt: windowResetAt(inputs),
    pendingRunAt: ms(inputs.pendingRunAt) === null ? null : new Date(ms(inputs.pendingRunAt)!),
    at: inputs.at,
  })
  return {
    waivers: s.waiver_type !== 'none_fcfs',
    free_agency_open: state.freeAgencyOpen,
    why: state.why,
    next_run_at: state.nextRunAt?.toISOString() ?? null,
    last_run_at: state.lastRunAt?.toISOString() ?? null,
    last_open_at: state.lastOpenAt?.toISOString() ?? null,
    time_zone: s.waiver_time_zone,
    paused: inputs.paused,
    evaluated_at: inputs.at.toISOString(),
  }
}
