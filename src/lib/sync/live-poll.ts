/**
 * live-poll — the production `sync-live` invocation (task L.D2.3; spec §14
 * "live stats ingestion" / §23.2 "poll cadence 20–30s in game windows" /
 * §23.3 "no code ever infers the current week from wall-clock math" /
 * E45; PROGRESS D322; discharges F216 (the rebind), binds F217 (the
 * persisted flag) and F238's release WRITER — the scheduled poll that
 * observes a week all-final and stamps `nfl_weeks.last_game_ends_at`).
 *
 * WHAT ONE INVOCATION DOES (a Vercel cron fires it every minute — the
 * finest cadence the platform offers; the 20–30 s cadence §23.2 asks for is
 * produced INSIDE the invocation by polling more than once per minute):
 *
 *   1. PLAN from the tables, never the clock alone (`planLivePoll`): read
 *      the season's `nfl_games` + `nfl_weeks` and decide —
 *        * HOT  — some in-week game (`scheduled` | `live`) has a kickoff
 *                 at or before now + `POLL_LEAD_MS`, and has NOT been
 *                 observed `final`: poll every week that has one, every
 *                 `POLL_CADENCE_MS`, for the invocation's budget. The
 *                 window CLOSES ON OBSERVATION, not on the clock (F216's
 *                 R711 amendment): a game that kicked off hours ago and is
 *                 still `live`/`scheduled` in the table keeps the week hot
 *                 until a poll sees it `final` — which is the poll that
 *                 stamps `last_game_ends_at` (F238's writer). The cost of
 *                 a game the provider never flips (Q37's cancelled game)
 *                 is one poll per minute, said in the plan; the
 *                 reconciliation names it (`game_not_final_late`).
 *        * SWEEP — nothing due, but this is the top-of-hour invocation
 *                 (minute 0 of the injected instant) OR the season has NO
 *                 game rows at all (F228's shape — the calendar is empty
 *                 and the composite provider's nflverse half can fill it):
 *                 ONE poll of the current calendar week (the greatest
 *                 `nfl_weeks.starts_at <= now`, clamped to week 1 before
 *                 the season), so schedule changes (flex moves, E42) reach
 *                 `nfl_games` within the hour with no game in progress.
 *        * IDLE — nothing due and not a sweep minute: return without a
 *                 provider call, the reason named.
 *   2. POLL — `ingestWeek(provider, time, { db, degradation, season,
 *      week })` per planned week (L.D2.1's writer, untouched), the tracker
 *      loaded from and persisted to `system_flags` around every poll
 *      (`ingest-flags.ts` — F217), the week's `ingest_poll` key stamped
 *      after a successful one (F218/R714's orphan escape datum).
 *   3. REPEAT while HOT and the budget allows: sleep `POLL_CADENCE_MS`,
 *      re-plan from the tables (a week whose last game was just observed
 *      final drops out), poll again. The provider's season-wide schedule
 *      read (the ~2 MB nflverse CSV, F216) is memoized PER ROUND — every
 *      week in one round shares one read; the next round reads fresh so a
 *      status flip is observed.
 *
 * The provider is BOUND BY THE ROUTE (D300 — never in here): production
 * passes `withNflverseCalendar(new SleeperStatsProvider(systemTime), new
 * NflverseProvider(systemTime))`; tests pass a fake. Time only via `time`
 * (the D3 fence covers this file); `sleep` is injected so the loop is
 * testable without waiting.
 */

import type { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { pageAll } from '@/lib/supabase/page-all'

import { type FlagsClient, loadDegradationTracker, persistPollOutcome, type StatsDegradedFlag } from './ingest-flags'
import { ingestWeek, type IngestReport } from './ingest-week'

// ── Constants (the route pins them beside `maxDuration`) ───────────────────

/** Poll from this long before a kickoff: inactives / status flips land pre-game. */
export const POLL_LEAD_MS = 15 * 60_000
/** In-window cadence — §23.2's "20–30s": three polls per minute-invocation (0 s, 20 s, 40 s), the next invocation at 60 s. */
export const POLL_CADENCE_MS = 20_000
/** The invocation's own budget: a round STARTS only while start + cadence < budget (so the last starts at 40 s); the route's `maxDuration` must exceed it. */
export const LIVE_POLL_BUDGET_MS = 45_000
/** The sweep minute — one schedule refresh per hour when nothing is due. */
export const SWEEP_MINUTE = 0

// ── The plan (pure) ────────────────────────────────────────────────────────

export interface CalendarGame {
  season: number
  week: number
  /** ISO instant. */
  kickoff_at: string
  /** 001's column is nullable (DEFAULT 'scheduled'); NULL reads as scheduled. */
  status: string | null
}

export interface CalendarWeek {
  season: number
  week: number
  /** ISO instant. */
  starts_at: string
}

export type PollMode = 'hot' | 'sweep' | 'idle'

export interface PollPlan {
  mode: PollMode
  /** Weeks to poll, ascending; empty when idle. */
  weeks: number[]
  /** In-week games at or past (now + lead) not yet observed final. */
  dueGames: number
  /** Games past their kickoff and still not final — the window held open by observation (R711). */
  openPastKickoff: number
  /** The current calendar week (the greatest `starts_at <= now`; 1 before the season). */
  currentWeek: number
  reasons: string[]
}

export interface PlanOptions {
  leadMs?: number
  sweepMinute?: number
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'live'])

function statusOf(g: CalendarGame): string {
  return g.status ?? 'scheduled'
}

/** The greatest calendar week whose `starts_at <= now`; week 1 before the season; 1 when the calendar is empty (named by the caller). */
export function currentCalendarWeek(weeks: readonly CalendarWeek[], now: Date): number {
  const nowMs = now.getTime()
  let current = 0
  for (const w of weeks) {
    if (new Date(w.starts_at).getTime() <= nowMs && w.week > current) current = w.week
  }
  if (current > 0) return current
  const first = weeks.reduce<number | null>((min, w) => (min === null || w.week < min ? w.week : min), null)
  return first ?? 1
}

export function planLivePoll(games: readonly CalendarGame[], weeks: readonly CalendarWeek[], now: Date, opts: PlanOptions = {}): PollPlan {
  const leadMs = opts.leadMs ?? POLL_LEAD_MS
  const sweepMinute = opts.sweepMinute ?? SWEEP_MINUTE
  const nowMs = now.getTime()
  const currentWeek = currentCalendarWeek(weeks, now)
  const reasons: string[] = []

  const due = games.filter((g) => OPEN_STATUSES.has(statusOf(g)) && new Date(g.kickoff_at).getTime() <= nowMs + leadMs)
  const openPastKickoff = due.filter((g) => new Date(g.kickoff_at).getTime() <= nowMs).length
  if (due.length > 0) {
    const dueWeeks = [...new Set(due.map((g) => g.week))].sort((a, b) => a - b)
    reasons.push(
      `hot: ${due.length} in-week game(s) at or within ${leadMs / 60_000} min of kickoff and not yet observed final (${openPastKickoff} past kickoff) — weeks ${dueWeeks.join(', ')}`,
    )
    return { mode: 'hot', weeks: dueWeeks, dueGames: due.length, openPastKickoff, currentWeek, reasons }
  }

  if (games.length === 0) {
    reasons.push(`sweep: the season has NO nfl_games rows — polling week ${currentWeek} so the provider's calendar can land (F228)`)
    return { mode: 'sweep', weeks: [currentWeek], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  if (now.getUTCMinutes() === sweepMinute) {
    reasons.push(`sweep: nothing due; top-of-hour schedule refresh of week ${currentWeek} (flex moves reach nfl_games within the hour, E42)`)
    return { mode: 'sweep', weeks: [currentWeek], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  reasons.push(`idle: no in-week game within ${leadMs / 60_000} min of kickoff or still open; next sweep at minute ${sweepMinute} — no provider call`)
  return { mode: 'idle', weeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
}

// ── Calendar reads (paged; the plan's inputs) ──────────────────────────────

export interface Calendar {
  games: CalendarGame[]
  weeks: CalendarWeek[]
}

export async function readCalendar(db: FlagsClient, season: number): Promise<Calendar> {
  const games = await pageAll<CalendarGame>((from, to) =>
    db.from('nfl_games').select('season, week, kickoff_at, status', { count: 'exact' }).eq('season', season).order('id').range(from, to),
  )
  const { data, error } = await db.from('nfl_weeks').select('season, week, starts_at').eq('season', season).order('week')
  if (error) throw new Error(`nfl_weeks read (${season}): ${error.message}`)
  return { games, weeks: (data ?? []) as CalendarWeek[] }
}

// ── The schedule memo (one provider read per round) ────────────────────────

export function withScheduleMemo(base: StatsProvider): StatsProvider & { resetScheduleMemo(): void } {
  let memo: { season: number; games: Promise<ProviderGame[]> } | null = null
  return {
    name: base.name,
    capabilities: base.capabilities,
    getSchedule(season: number) {
      if (!memo || memo.season !== season) memo = { season, games: base.getSchedule(season) }
      return memo.games
    },
    getGameStates: (season, week) => base.getGameStates(season, week),
    getWeekStats: (season, week) => base.getWeekStats(season, week),
    getInjuries: (season, week) => base.getInjuries(season, week),
    getInactives: (season, week) => base.getInactives(season, week),
    resetScheduleMemo() {
      memo = null
    },
  }
}

// ── The invocation ─────────────────────────────────────────────────────────

export interface LivePollDeps {
  db: FlagsClient
  provider: StatsProvider
  time: TimeProvider
  sleep: (ms: number) => Promise<void>
  season: number
  /** The invocation's budget — the route's `maxDuration` must exceed it. */
  budgetMs?: number
  /** Injectable for the loop's tests; production passes nothing (ingestWeek). */
  ingest?: typeof ingestWeek
  /** Injectable for the loop's tests. */
  loadTracker?: (db: FlagsClient) => Promise<DegradationTracker>
  persist?: (db: FlagsClient, tracker: DegradationTracker, report: IngestReport) => Promise<StatsDegradedFlag>
  planOptions?: PlanOptions
}

export interface PollRound {
  /** The plan this round ran under. */
  plan: PollPlan
  polls: Array<{ week: number; report: IngestReport; flag: StatsDegradedFlag }>
}

export interface LivePollInvocationReport {
  season: number
  started_at: string
  finished_at: string
  rounds: PollRound[]
  /** The final flag after the last poll (null when idle — nothing polled). */
  flag: StatsDegradedFlag | null
  /** Every loud thing, one line each. */
  problems: string[]
  /** Why nothing was polled — never an empty success by default. */
  reason: 'idle' | null
}

export async function runLivePollInvocation(deps: LivePollDeps): Promise<LivePollInvocationReport> {
  const budgetMs = deps.budgetMs ?? LIVE_POLL_BUDGET_MS
  const ingest = deps.ingest ?? ingestWeek
  const loadTracker = deps.loadTracker ?? loadDegradationTracker
  const persist = deps.persist ?? persistPollOutcome
  const provider = withScheduleMemo(deps.provider)
  const startedMs = deps.time.now().getTime()
  const report: LivePollInvocationReport = {
    season: deps.season,
    started_at: new Date(startedMs).toISOString(),
    finished_at: new Date(startedMs).toISOString(),
    rounds: [],
    flag: null,
    problems: [],
    reason: null,
  }

  for (;;) {
    const now = deps.time.now()
    const calendar = await readCalendar(deps.db, deps.season)
    const plan = planLivePoll(calendar.games, calendar.weeks, now, deps.planOptions)
    if (plan.mode === 'idle') {
      if (report.rounds.length === 0) {
        report.reason = 'idle'
        report.problems.push(`polled nothing: ${plan.reasons.join('; ')}`)
      }
      break
    }

    provider.resetScheduleMemo()
    const round: PollRound = { plan, polls: [] }
    for (const week of plan.weeks) {
      const tracker = await loadTracker(deps.db)
      const poll = await ingest(provider, deps.time, { db: deps.db, degradation: tracker, season: deps.season, week })
      const flag = await persist(deps.db, tracker, poll)
      round.polls.push({ week, report: poll, flag })
      report.flag = flag
      if (!poll.ok) {
        report.problems.push(
          `week ${week}: provider poll FAILED (${poll.error ?? 'unknown'}) — nothing written; consecutive failures ${flag.consecutive_failures}${flag.degraded ? ' — stats_degraded RAISED (§23.2/E45)' : ''}`,
        )
      } else {
        // A successful poll that could not write the calendar is said out
        // loud (F228: a kickoff-less tier writes no nfl_games — never quiet).
        for (const reason of poll.reasons) {
          if (reason.startsWith('nfl_games untouched') || reason.startsWith('provider returned zero games')) {
            report.problems.push(`week ${week}: ${reason}`)
          }
        }
      }
    }
    report.rounds.push(round)

    if (plan.mode !== 'hot') break
    // The next round would START at elapsed + cadence; it runs only while
    // that instant is inside the budget (0 s, 20 s, 40 s under the defaults).
    const elapsed = deps.time.now().getTime() - startedMs
    if (elapsed + POLL_CADENCE_MS >= budgetMs) break
    await deps.sleep(POLL_CADENCE_MS)
  }

  report.finished_at = deps.time.now().toISOString()
  return report
}
