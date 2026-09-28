/**
 * The waiver schedule — when waivers run and when instant-pickup free agency
 * is open (M5 task L.D2.7; PROGRESS Q70 RULED by Chris 2026-09-27 "approve
 * M5, all recommendations", F229's investigation; spec §7.3.4 / §13.1 /
 * §13.2 v2.16.59; tasks-M5 TD14).
 *
 * THE RULING, IN LEAGUE TERMS
 *   - A league sets (a) WHEN WAIVERS RUN — one or more weekdays at one local
 *     time, in the league's own IANA zone — and (b) WHEN FREE AGENCY IS OPEN:
 *     from the waiver run, or from a set weekday + time, until the week's
 *     last game ends (or never — a claims-only league).
 *   - Outside free agency every unowned player is claim-only until the next
 *     run. A dropped player is on waivers until the next run. Right after the
 *     draft every undrafted player is on waivers until the first run after
 *     the draft. When the week ends (its last game — `nfl_weeks.
 *     last_game_ends_at`) everyone goes back to claim-only until the next run.
 *   - `none_fcfs` ("no waivers") is always free agency; a drop goes straight
 *     to free agency.
 *
 * THE WINDOW, AS ARITHMETIC (the SQL twin is migration 149's
 * `waiver_window_internal`; the two are pinned to the same literals)
 *   reset  = the latest of: the league's draft completing, the end of any
 *            NFL week of its season — whichever is latest and not after `at`
 *            (null when neither has happened: a fixture league).
 *   runs   = scheduled run instants ≤ at — and, once the processor tracks the
 *            league (`leagues.waiver_next_run_at` set), strictly before that
 *            pending run: a run counts only after it has been PROCESSED, so an
 *            instant add can never beat the claims the run is settling (E8).
 *   after_waiver_run: open ⇔ a counted run at or after the reset.
 *   day_and_time:     open ⇔ a counted run at or after the reset AND the
 *                     weekly opening instant has passed since the reset
 *                     (strictly after it — an opening at the very instant the
 *                     week ends opens nothing).
 *   never:            never open.
 *   A run AT the reset instant counts (Q78: "waivers run on schedule" at the
 *   week's close).
 *
 * PURE — no clock is read; every instant is an argument (the D3 fence).
 */

import { wallClockAt, weekdayOf, zonedWallToUtc } from './zoned-time'

/** Weekday vocabulary, index = JS/Postgres `dow` (0 = Sunday). */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** When instant-pickup free agency opens each week (it always closes when the week's last game ends). */
export const FREE_AGENCY_OPENS = ['after_waiver_run', 'day_and_time', 'never'] as const
export type FreeAgencyOpens = (typeof FREE_AGENCY_OPENS)[number]

/** HH:MM, 24-hour, league-local. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The six stored keys (the `leagues.settings` blob half of §7.3.4 v2.16.59). */
export interface WaiverSchedule {
  waiver_run_days: Weekday[]
  waiver_run_time: string
  waiver_time_zone: string
  free_agency_opens: FreeAgencyOpens
  free_agency_open_day: Weekday
  free_agency_open_time: string
}

export type WaiverType = 'faab' | 'rolling_priority' | 'reverse_standings' | 'none_fcfs'

/** The six keys, in catalog order — every surface that copies a schedule copies exactly these. */
export const WAIVER_SCHEDULE_KEYS = [
  'waiver_run_days',
  'waiver_run_time',
  'waiver_time_zone',
  'free_agency_opens',
  'free_agency_open_day',
  'free_agency_open_time',
] as const satisfies readonly (keyof WaiverSchedule)[]

/** Sort weekdays into Sunday-first order and drop duplicates — the stored (canonical) form. */
export function canonicalWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((d) => days.includes(d))
}

function hhmm(value: string, what: string): [number, number] {
  if (!HH_MM.test(value)) throw new Error(`waiver schedule: ${what} must be HH:MM (24h) — got ${JSON.stringify(value)}`)
  return [Number(value.slice(0, 2)), Number(value.slice(3, 5))]
}

/**
 * Every instant in [lo, hi] local-day range at which `days` × `time` fires,
 * around `anchor`: local calendar dates from `anchor`'s date + `fromDay` to
 * + `toDay`. Ascending.
 */
function weeklyInstants(zone: string, days: readonly Weekday[], time: string, anchor: Date, fromDay: number, toDay: number): Date[] {
  if (days.length === 0) throw new Error('waiver schedule: at least one run day is required')
  const [h, m] = hhmm(time, 'the time')
  const w = wallClockAt(zone, anchor)
  const wanted = new Set(days.map((d) => WEEKDAYS.indexOf(d)))
  const out: Date[] = []
  for (let k = fromDay; k <= toDay; k++) {
    if (wanted.has(weekdayOf(w.year, w.month, w.day + k))) out.push(zonedWallToUtc(zone, w.year, w.month, w.day + k, h, m))
  }
  return out
}

/** The first scheduled waiver run STRICTLY AFTER `after` (a drop at the run instant waits for the next one). */
export function nextWaiverRun(s: Pick<WaiverSchedule, 'waiver_run_days' | 'waiver_run_time' | 'waiver_time_zone'>, after: Date): Date {
  const found = weeklyInstants(s.waiver_time_zone, s.waiver_run_days, s.waiver_run_time, after, -1, 8).find(
    (t) => t.getTime() > after.getTime(),
  )
  if (!found) throw new Error('waiver schedule: no run found in the following week (unreachable for a non-empty day set)')
  return found
}

/** The latest scheduled waiver run AT OR BEFORE `at`. */
export function lastWaiverRun(s: Pick<WaiverSchedule, 'waiver_run_days' | 'waiver_run_time' | 'waiver_time_zone'>, at: Date): Date {
  const all = weeklyInstants(s.waiver_time_zone, s.waiver_run_days, s.waiver_run_time, at, -8, 1).filter(
    (t) => t.getTime() <= at.getTime(),
  )
  const found = all[all.length - 1]
  if (!found) throw new Error('waiver schedule: no run found in the previous week (unreachable for a non-empty day set)')
  return found
}

/** The latest weekly free-agency opening instant AT OR BEFORE `at` (day_and_time mode). */
export function lastFreeAgencyOpen(
  s: Pick<WaiverSchedule, 'free_agency_open_day' | 'free_agency_open_time' | 'waiver_time_zone'>,
  at: Date,
): Date {
  const all = weeklyInstants(s.waiver_time_zone, [s.free_agency_open_day], s.free_agency_open_time, at, -8, 1).filter(
    (t) => t.getTime() <= at.getTime(),
  )
  return all[all.length - 1]
}

/** Why the window is what it is — the same vocabulary migration 149's `waiver_window_internal` returns. */
export type WindowWhy =
  | 'no_waivers' // none_fcfs: always free agency
  | 'open' // free agency is open
  | 'awaiting_run' // no waiver run since the draft / the week ended
  | 'run_pending' // that run is due but the processor has not settled it yet
  | 'before_opening_time' // day_and_time: the run happened, the weekly opening has not
  | 'claims_only' // free_agency_opens = never

export interface WindowInput {
  schedule: WaiverSchedule
  waiverType: WaiverType
  /** The latest of draft completion / week end not after `at`; null = neither has happened. */
  resetAt: Date | null
  /** `leagues.waiver_next_run_at` — the next UNPROCESSED run; null = the processor does not track the league yet. */
  pendingRunAt: Date | null
  at: Date
}

export interface WindowState {
  freeAgencyOpen: boolean
  why: WindowWhy
  /** The latest run that COUNTS (processed, or scheduled when untracked); null under none_fcfs. */
  lastRunAt: Date | null
  /** day_and_time only: the latest weekly opening instant ≤ at. */
  lastOpenAt: Date | null
  /** The next scheduled run strictly after `at` — where a claim settles; null under none_fcfs. */
  nextRunAt: Date | null
}

export function freeAgencyWindow(input: WindowInput): WindowState {
  const { schedule: s, waiverType, resetAt, pendingRunAt, at } = input
  if (waiverType === 'none_fcfs') {
    return { freeAgencyOpen: true, why: 'no_waivers', lastRunAt: null, lastOpenAt: null, nextRunAt: null }
  }
  const scheduled = lastWaiverRun(s, at)
  const counted =
    pendingRunAt !== null && scheduled.getTime() >= pendingRunAt.getTime()
      ? lastWaiverRun(s, new Date(pendingRunAt.getTime() - 1))
      : scheduled
  const nextRunAt = nextWaiverRun(s, at)
  const sinceReset = (t: Date) => resetAt === null || t.getTime() >= resetAt.getTime()
  const runSinceReset = sinceReset(counted)
  const runWhy: WindowWhy = sinceReset(scheduled) ? 'run_pending' : 'awaiting_run'
  if (s.free_agency_opens === 'never') {
    return { freeAgencyOpen: false, why: 'claims_only', lastRunAt: counted, lastOpenAt: null, nextRunAt }
  }
  if (s.free_agency_opens === 'after_waiver_run') {
    return { freeAgencyOpen: runSinceReset, why: runSinceReset ? 'open' : runWhy, lastRunAt: counted, lastOpenAt: null, nextRunAt }
  }
  const lastOpenAt = lastFreeAgencyOpen(s, at)
  const openedSinceReset = resetAt === null || lastOpenAt.getTime() > resetAt.getTime()
  const open = runSinceReset && openedSinceReset
  return {
    freeAgencyOpen: open,
    why: open ? 'open' : !runSinceReset ? runWhy : 'before_opening_time',
    lastRunAt: counted,
    lastOpenAt,
    nextRunAt,
  }
}

// ---------------------------------------------------------------------------
// Presets — Chris's two leagues (Q70), "no waivers", and the catalog default
// ---------------------------------------------------------------------------

export type WaiverPresetId = 'standard_wednesday' | 'daily_weekend_free_agency' | 'weekly_then_free_agency' | 'no_waivers'

export interface WaiverPreset {
  id: WaiverPresetId
  label: string
  description: string
  /** `none_fcfs` for "no waivers"; null = the preset leaves the league's waiver type alone. */
  waiverType: 'none_fcfs' | null
  schedule: WaiverSchedule
}

const OPEN_DEFAULTS = { free_agency_open_day: 'sun', free_agency_open_time: '06:00' } as const

/** The §7.3.4 catalog default (Wednesday 03:00 Eastern, D60's instant kept) — `LEAGUE_SETTINGS_DEFAULTS` reads it. */
export const DEFAULT_WAIVER_SCHEDULE: WaiverSchedule = Object.freeze({
  waiver_run_days: Object.freeze(['wed']) as unknown as Weekday[],
  waiver_run_time: '03:00',
  waiver_time_zone: 'America/New_York',
  free_agency_opens: 'after_waiver_run',
  ...OPEN_DEFAULTS,
}) as WaiverSchedule

export const WAIVER_PRESETS: readonly WaiverPreset[] = Object.freeze([
  {
    id: 'standard_wednesday',
    label: 'Weekly waivers, Wednesday 3:00 AM Eastern',
    description: 'Waivers run once a week, Wednesday at 3:00 AM Eastern; free agency is open from then until the week’s last game ends.',
    waiverType: null,
    schedule: DEFAULT_WAIVER_SCHEDULE,
  },
  {
    // Q70, league 1 (Chris, verbatim in PROGRESS F229): "waivers run every 24
    // hours at 9am PST all week until Sunday at 6am when they go to instant
    // pickup free agency until Monday night after the last game".
    id: 'daily_weekend_free_agency',
    label: 'Daily waivers, weekend free agency',
    description:
      'Waivers run every day Tuesday through Saturday at 9:00 AM Pacific; free agency opens Sunday at 6:00 AM Pacific and lasts until the week’s last game ends.',
    waiverType: null,
    schedule: {
      waiver_run_days: ['tue', 'wed', 'thu', 'fri', 'sat'],
      waiver_run_time: '09:00',
      waiver_time_zone: 'America/Los_Angeles',
      free_agency_opens: 'day_and_time',
      free_agency_open_day: 'sun',
      free_agency_open_time: '06:00',
    },
  },
  {
    // Q70, league 2: "only does waivers on Tuesday at Midnight and then goes
    // to instant pickup for the rest of the week". "Tuesday at midnight" is
    // read as the END of Tuesday (Wednesday 00:00 Pacific) — Chris's own
    // idiom: he calls the Monday-night release "midnight PST Monday"
    // (Q34(B)), i.e. the end of Monday. A preset is a starting point; the
    // days and time stay editable (D388).
    id: 'weekly_then_free_agency',
    label: 'Weekly waivers Tuesday midnight, then free agency',
    description:
      'Waivers run once a week at midnight at the end of Tuesday, Pacific; free agency is open from then until the week’s last game ends.',
    waiverType: null,
    schedule: {
      waiver_run_days: ['wed'],
      waiver_run_time: '00:00',
      waiver_time_zone: 'America/Los_Angeles',
      free_agency_opens: 'after_waiver_run',
      ...OPEN_DEFAULTS,
    },
  },
  {
    id: 'no_waivers',
    label: 'No waivers — always free agency',
    description: 'Every unowned player whose game has not started can be picked up at once; a dropped player is a free agent right away.',
    waiverType: 'none_fcfs',
    schedule: DEFAULT_WAIVER_SCHEDULE,
  },
])

function sameSchedule(a: WaiverSchedule, b: WaiverSchedule): boolean {
  const days = (x: WaiverSchedule) => canonicalWeekdays(x.waiver_run_days).join(',')
  if (days(a) !== days(b) || a.waiver_run_time !== b.waiver_run_time || a.waiver_time_zone !== b.waiver_time_zone) return false
  if (a.free_agency_opens !== b.free_agency_opens) return false
  if (a.free_agency_opens !== 'day_and_time') return true
  return a.free_agency_open_day === b.free_agency_open_day && a.free_agency_open_time === b.free_agency_open_time
}

/** Which preset a league's stored settings are, or null for a custom schedule. */
export function matchWaiverPreset(settings: WaiverSchedule & { waiver_type: WaiverType }): WaiverPresetId | null {
  if (settings.waiver_type === 'none_fcfs') return 'no_waivers'
  const hit = WAIVER_PRESETS.find((p) => p.waiverType === null && sameSchedule(p.schedule, settings))
  return hit ? hit.id : null
}

const DAY_WORDS: Record<Weekday, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
}

function clockWords(time: string): string {
  const [h, m] = hhmm(time, 'the time')
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

function dayListWords(days: readonly Weekday[]): string {
  const c = canonicalWeekdays(days)
  if (c.length === 7) return 'every day'
  const words = c.map((d) => DAY_WORDS[d])
  if (words.length === 1) return words[0]
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** The stored schedule said plainly — one sentence, the league's zone named (never a promise the server does not keep). */
export function describeWaiverSchedule(settings: WaiverSchedule & { waiver_type: WaiverType }): string {
  if (settings.waiver_type === 'none_fcfs') {
    return 'No waivers: any unowned player whose game has not started can be picked up at once, and a dropped player is a free agent right away.'
  }
  const zone = settings.waiver_time_zone
  const runs = `Waivers run ${dayListWords(settings.waiver_run_days)} at ${clockWords(settings.waiver_run_time)} (${zone})`
  switch (settings.free_agency_opens) {
    case 'after_waiver_run':
      return `${runs}; free agency is open from the waiver run until the week’s last game ends.`
    case 'day_and_time':
      return `${runs}; free agency opens ${DAY_WORDS[settings.free_agency_open_day]} at ${clockWords(settings.free_agency_open_time)} and lasts until the week’s last game ends.`
    case 'never':
      return `${runs}; there is no free agency — every pickup is a waiver claim.`
  }
}
