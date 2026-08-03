/**
 * League-home state machine — pure derivation (M1 task L.A2.7; spec §16.5.1
 * setup/scheduled rows, §16.4 timezones). Colocated with the component (the
 * invite-panel-ops / wizard-ops / claim-invite-card-ops precedent) and pure so
 * the golden pins run without React.
 *
 * Deliberately NOT under `src/lib/leagues/**` — the home is a UI surface, not
 * league engine, so the D3 TimeProvider ESLint guard does not apply (the M1
 * gate governs league LOGIC, not a countdown's display formatting). Even so,
 * every time-dependent read takes `nowMs` as a parameter (never a wall-clock
 * read inside), so the countdown is deterministic and pinnable — the component
 * owns the ticking clock.
 */

import type { LeagueDetail } from '@/hooks/use-league'

// ---------------------------------------------------------------------------
// status → home state (§16.5.1)
// ---------------------------------------------------------------------------

/**
 * Which home hero renders for a `leagues.status`. M1 builds `setup` +
 * `scheduled`; every later lifecycle status (`drafting`/`in_season`/`playoffs`/
 * `complete`) renders a clearly-marked "not yet" placeholder — never mock data
 * (task item 1). Unknown/invalid statuses fall through to `later` too.
 */
export type HomeState = 'setup' | 'scheduled' | 'later'

export function homeStateForStatus(status: string): HomeState {
  if (status === 'setup') return 'setup'
  if (status === 'scheduled') return 'scheduled'
  return 'later'
}

/** Human label for a later-status "not yet" placeholder (§7.1 six-state enum). */
export function laterStatusLabel(status: string): string {
  switch (status) {
    case 'drafting':
      return 'Draft in progress'
    case 'in_season':
      return 'In season'
    case 'playoffs':
      return 'Playoffs'
    case 'complete':
      return 'Season complete'
    default:
      return 'Coming soon'
  }
}

// ---------------------------------------------------------------------------
// Seats — n/N (§16.5.1 "seats n/N")
// ---------------------------------------------------------------------------

export interface SeatCounts {
  /** Seats with a real, seated manager (a claimed franchise). */
  filled: number
  /** team_count — the total seats the league will field (leagues.max_teams). */
  total: number
  /** Seats without a seated manager (total − filled, ≥ 0). */
  open: number
}

/**
 * n/N for the setup checklist: n = claimed seats (`league_members` with a
 * `user_id`), N = `max_teams`. Placeholder/invited seats are NOT yet a seated
 * manager, so they count toward `open` — each one still needs a manager, and
 * each gets an invite affordance in the hero (R112).
 */
export function seatCounts(detail: LeagueDetail): SeatCounts {
  const total = detail.league.max_teams
  const filled = detail.members.filter((m) => m.user_id != null).length
  return { filled, total, open: Math.max(0, total - filled) }
}

// ---------------------------------------------------------------------------
// Setup checklist (§16.5.1 setup row)
// ---------------------------------------------------------------------------

export type ChecklistKey = 'settings' | 'seats' | 'scoring' | 'schedule'

export interface ChecklistItem {
  key: ChecklistKey
  label: string
  done: boolean
  /** Short progress line (e.g. "6 / 12 seats filled"). */
  detail: string
}

/**
 * The four setup-checklist items, done/not-done derived from the REAL league
 * row (task item 1 · the orchestrator pointer): settings ✓ (a created league
 * carries a validated §7.3 settings object — always complete by construction),
 * seats n/N (claimed vs total), scoring template chosen (`scoring_system_id`
 * set), schedule draft (`settings.draft.draft_scheduled_at` set — the D60(4)
 * NESTED path, never top-level).
 */
export function deriveSetupChecklist(detail: LeagueDetail): ChecklistItem[] {
  const seats = seatCounts(detail)
  const hasScoring = detail.league.scoring_system_id != null
  const scheduledAt = detail.settings.draft.draft_scheduled_at
  const hasSchedule = typeof scheduledAt === 'string' && scheduledAt !== ''
  const scheduleDetail =
    typeof scheduledAt === 'string' && scheduledAt !== ''
      ? describeScheduleDetail(scheduledAt)
      : 'Not scheduled yet'

  return [
    {
      key: 'settings',
      label: 'League settings configured',
      done: true,
      detail: 'Format, roster, and rules are set',
    },
    {
      key: 'seats',
      label: 'Fill the manager seats',
      done: seats.open === 0,
      detail: `${seats.filled} / ${seats.total} seats filled`,
    },
    {
      key: 'scoring',
      label: 'Scoring template chosen',
      done: hasScoring,
      detail: hasScoring ? 'A scoring template is set' : 'Pick a scoring template',
    },
    {
      key: 'schedule',
      label: 'Schedule the draft',
      done: hasSchedule,
      // Once scheduled, surface the actual date & time (league reference
      // time, §16.4) right on the home checklist row.
      detail: scheduleDetail,
    },
  ]
}

/** Checklist detail once a draft time exists — the §16.4 league-reference
 *  half ("Scheduled for Sun, Aug 30, 2026 · 7:00 PM (UTC−4)"). */
function describeScheduleDetail(scheduledAtIso: string): string {
  const display = describeDraftTime(scheduledAtIso)
  if (!display) return 'Draft time is set'
  return `Scheduled for ${display.leagueTime}${
    display.leagueOffset ? ` (${display.leagueOffset})` : ''
  }`
}

/** How many of the setup checklist items are complete. */
export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length }
}

// ---------------------------------------------------------------------------
// Draft countdown (§16.5.1 scheduled row · §16.4 timezones)
// ---------------------------------------------------------------------------

export interface Countdown {
  /** The draft instant in epoch ms. */
  targetMs: number
  /** ms until the draft, floored at 0. */
  remainingMs: number
  /** True once the scheduled instant has passed (target ≤ now). */
  isPast: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * Countdown parts for a `draft_scheduled_at` instant. Pure — `nowMs` is
 * injected so the parts are deterministic and pinnable. Returns null when the
 * stored instant is unparseable (the UI degrades to "time unavailable").
 */
export function draftCountdown(scheduledAtIso: string, nowMs: number): Countdown | null {
  const targetMs = Date.parse(scheduledAtIso)
  if (Number.isNaN(targetMs)) return null
  const remainingMs = Math.max(0, targetMs - nowMs)
  const isPast = targetMs <= nowMs
  const totalSeconds = Math.floor(remainingMs / 1000)
  return {
    targetMs,
    remainingMs,
    isPast,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

// ---------------------------------------------------------------------------
// Timezone display (§16.4 — "league TZ + viewer-local")
// ---------------------------------------------------------------------------
//
// M1 stores no IANA league zone for the draft (the §7.3.8 draft block carries
// `draft_scheduled_at` as an ISO-with-offset instant, not a named zone; the
// per-league IANA zone §16.4 anticipates is an M2 draft-setup-panel concern).
// So the "league reference time" the countdown shows is the stored instant
// rendered AT THE OFFSET the commissioner scheduled it with — pure and
// pinnable here — while the VIEWER-LOCAL rendering uses the browser's zone via
// Intl in the component (env-dependent, so not pinned).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * The trailing UTC offset of an ISO-8601 instant, in minutes (`Z` → 0). Returns
 * null when no offset is present (a bare local timestamp — which the contract's
 * `datetime({ offset: true })` never emits, but callers stay defensive).
 */
export function parseIsoOffsetMinutes(iso: string): number | null {
  const trimmed = iso.trim()
  if (/[zZ]$/.test(trimmed)) return 0
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(trimmed)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3]))
}

/** "UTC" · "UTC−4" · "UTC+5:30" — the offset label (U+2212 minus for negatives). */
export function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC'
  const sign = offsetMinutes > 0 ? '+' : '−'
  const abs = Math.abs(offsetMinutes)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  return mins === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(mins).padStart(2, '0')}`
}

/**
 * Format an instant at a fixed UTC offset, e.g. "Sat, Aug 30, 2026 · 7:00 PM".
 * Pure: shifts the epoch ms by the offset and reads UTC parts, so the output is
 * the wall-clock time at that offset regardless of where the code runs.
 */
export function formatInstantAtOffset(targetMs: number, offsetMinutes: number): string {
  const shifted = new Date(targetMs + offsetMinutes * 60_000)
  const weekday = WEEKDAYS[shifted.getUTCDay()]
  const month = MONTHS[shifted.getUTCMonth()]
  const day = shifted.getUTCDate()
  const year = shifted.getUTCFullYear()
  const rawHour = shifted.getUTCHours()
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0')
  const ampm = rawHour >= 12 ? 'PM' : 'AM'
  const hour12 = rawHour % 12 === 0 ? 12 : rawHour % 12
  return `${weekday}, ${month} ${day}, ${year} · ${hour12}:${minute} ${ampm}`
}

export interface DraftTimeDisplay {
  /** The league reference time: the stored instant at its scheduled offset. */
  leagueTime: string
  /** The offset label for that reference time ("UTC", "UTC−4", …), or null. */
  leagueOffset: string | null
}

/**
 * The league-reference half of the §16.4 timezone rule for a draft instant.
 * Viewer-local is the component's job (Intl); this is the pinnable half.
 */
export function describeDraftTime(scheduledAtIso: string): DraftTimeDisplay | null {
  const targetMs = Date.parse(scheduledAtIso)
  if (Number.isNaN(targetMs)) return null
  const offset = parseIsoOffsetMinutes(scheduledAtIso)
  if (offset === null) {
    return { leagueTime: formatInstantAtOffset(targetMs, 0), leagueOffset: null }
  }
  return {
    leagueTime: formatInstantAtOffset(targetMs, offset),
    leagueOffset: offsetLabel(offset),
  }
}
