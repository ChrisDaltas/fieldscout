/**
 * live-poll — the production `sync-live` invocation (task L.D2.3; spec §14
 * "live stats ingestion" / §23.2 "poll cadence 20–30s in game windows" /
 * §23.3 "no code ever infers the current week from wall-clock math" /
 * E45; PROGRESS D322; discharges F216 (the rebind), binds F217 (the
 * persisted flag) and F238's release WRITER — the scheduled poll that
 * observes a week all-final and stamps `nfl_weeks.last_game_ends_at`).
 *
 * WHAT ONE INVOCATION DOES (the scheduler fires it every minute — the
 * finest cadence Vercel offers, and only on a paid plan: the route is BUILT
 * and UNSCHEDULED until PROGRESS Q43 picks the scheduler, R884; the 20–30 s
 * cadence §23.2 asks for is produced INSIDE the invocation by polling more
 * than once per minute):
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
 *                 is THREE polls per hot minute (0 / 20 / 40 s, each a
 *                 fresh ~2 MB nflverse CSV read — ≈ 8.6 GB/day, R878),
 *                 said in the plan; the reconciliation names it
 *                 (`game_not_final_late` — an ALERT once the week is past
 *                 its correction window and can no longer finalize).
 *                 On the sweep minute a HOT plan also CARRIES the sweep
 *                 (`sweepWeeks`, F509): the weeks below that are not
 *                 already hot are polled once in the invocation, so a
 *                 stuck game never starves the hourly refresh or the
 *                 re-polls.
 *        * SWEEP — nothing due, but this is the top-of-hour invocation
 *                 (minute 0 of the injected instant) OR the season has NO
 *                 game rows at all (F228's shape — the calendar is empty
 *                 and the composite provider's nflverse half can fill it):
 *                 ONE poll of the current calendar week (the greatest
 *                 `nfl_weeks.starts_at <= now`, clamped to week 1 before
 *                 the season), so schedule changes (flex moves, E42) reach
 *                 `nfl_games` within the hour with no game in progress —
 *                 PLUS every earlier week still inside its stat-correction
 *                 window (F270, closed by M5 L.D3.11: a late correction is
 *                 ingested and re-scored before the week locks) — PLUS, at
 *                 the sweep of FINAL_WEEK_REPOLL_UTC_HOUR only, every week
 *                 whose window closed within FINAL_WEEK_REPOLL_DAYS (TD5, M6
 *                 L.E2.1: once a day for 7 days after it locks, so a late
 *                 correction is RECORDED — `stat_correction_events` — and
 *                 research stays right; the worker consumes its deltas as
 *                 `week_final` and no score moves).
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
/** TD5 (M6 L.E2.1): a FINAL week (its correction window closed) is re-polled
 *  once a day for this many days after it locks, so a late correction is
 *  recorded (`stat_correction_events`) and research stays right. Nothing it
 *  finds changes a score: the worker consumes a final week's deltas as
 *  `week_final` (D295(b)) and the scoring door refuses the week (158). */
export const FINAL_WEEK_REPOLL_DAYS = 7
/** …at the sweep of this UTC hour (11:00Z = 07:00 ET / 06:00 EST — before the
 *  11:15Z reconcile, which then sees the morning's re-poll). */
export const FINAL_WEEK_REPOLL_UTC_HOUR = 11

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
  /** ISO instant — the end of the week's stat-correction window (M5 L.D3.11 /
   *  migration 158: the next week's first kickoff; before 158, 039's Thursday
   *  06:00 ET). A past week still inside it is re-polled on every sweep (F270). */
  correction_window_ends_at?: string | null
}

export type PollMode = 'hot' | 'sweep' | 'idle'

export interface PollPlan {
  mode: PollMode
  /** Weeks to poll, ascending; empty when idle. */
  weeks: number[]
  /** HOT on the sweep minute only (F509): the weeks the sweep would poll that
   *  are not already hot — polled once per invocation, after the hot weeks.
   *  Empty for every other plan. */
  sweepWeeks: number[]
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
  /** TD5's daily re-poll hour (UTC); default FINAL_WEEK_REPOLL_UTC_HOUR. */
  finalRepollHourUtc?: number
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

/** Weeks before `currentWeek` whose correction window has not closed at `now` (ascending) — F270's re-poll set. */
export function weeksInCorrectionWindow(weeks: readonly CalendarWeek[], currentWeek: number, now: Date): number[] {
  const nowMs = now.getTime()
  return weeks
    .filter((w) => w.week < currentWeek && w.correction_window_ends_at != null && new Date(w.correction_window_ends_at).getTime() > nowMs)
    .map((w) => w.week)
    .sort((a, b) => a - b)
}

/**
 * TD5 — weeks before `currentWeek` whose correction window has CLOSED at
 * `now`, and closed less than `days` days ago (ascending). The window's end
 * is the lock's instant to within the hourly finalize (158); a week whose
 * window is still open is F270's set, never this one. Cheap by construction:
 * with a weekly calendar this is one week (two for a moment at a boundary).
 */
export function finalWeeksForRepoll(
  weeks: readonly CalendarWeek[],
  currentWeek: number,
  now: Date,
  days: number = FINAL_WEEK_REPOLL_DAYS,
): number[] {
  const nowMs = now.getTime()
  const reachMs = days * 86_400_000
  return weeks
    .filter((w) => {
      if (w.week >= currentWeek || w.correction_window_ends_at == null) return false
      const endsMs = new Date(w.correction_window_ends_at).getTime()
      return endsMs <= nowMs && nowMs < endsMs + reachMs
    })
    .map((w) => w.week)
    .sort((a, b) => a - b)
}

/** The sweep's weeks at `now` (a sweep minute): the current week first
 *  (R1265), then F270's open-window weeks, then — at TD5's hour only — the
 *  weeks locked within FINAL_WEEK_REPOLL_DAYS. Shared by the sweep and the
 *  hot plan that carries it (F509). */
function sweepTargets(weeks: readonly CalendarWeek[], currentWeek: number, now: Date, opts: PlanOptions) {
  const inWindow = weeksInCorrectionWindow(weeks, currentWeek, now)
  // TD5 (M6 L.E2.1): once a day, each week locked within the last
  // FINAL_WEEK_REPOLL_DAYS days too — its late corrections are RECORDED
  // (stat_correction_events) and player_stats stays right for research;
  // no score moves (the worker's week_final, 158's lock).
  const finalRepoll =
    now.getUTCHours() === (opts.finalRepollHourUtc ?? FINAL_WEEK_REPOLL_UTC_HOUR)
      ? finalWeeksForRepoll(weeks, currentWeek, now).filter((w) => !inWindow.includes(w))
      : []
  return { inWindow, finalRepoll, all: [currentWeek, ...inWindow, ...finalRepoll] }
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
    // F509: a game the provider never flips to final (Q37's cancelled game)
    // keeps the poll HOT for as long as it is open — and HOT used to return
    // before the sweep, so the hourly refresh, F270's re-poll of weeks still
    // inside their correction window and TD5's daily re-poll of final weeks
    // all waited for that game. On the sweep minute the hot plan now CARRIES
    // the sweep: every week the sweep would poll that is not already hot
    // (`sweepWeeks`); the loop polls them once per invocation. Nothing here
    // decides what a stuck game IS (Q37 / E43 rule that) — it only stops one
    // from starving the other weeks.
    const sweepWeeks =
      now.getUTCMinutes() === sweepMinute ? sweepTargets(weeks, currentWeek, now, opts).all.filter((w) => !dueWeeks.includes(w)) : []
    if (sweepWeeks.length > 0) {
      reasons.push(
        `sweep carried on the hot minute (F509): week(s) ${sweepWeeks.join(', ')} — the hourly refresh and the re-polls never wait for a game not yet observed final`,
      )
    }
    return { mode: 'hot', weeks: dueWeeks, sweepWeeks, dueGames: due.length, openPastKickoff, currentWeek, reasons }
  }

  if (games.length === 0) {
    reasons.push(`sweep: the season has NO nfl_games rows — polling week ${currentWeek} so the provider's calendar can land (F228)`)
    return { mode: 'sweep', weeks: [currentWeek], sweepWeeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  // F270 CLOSED (M5 L.D3.11, R1260): the sweep re-polls the CURRENT week AND
  // every earlier week still inside its stat-correction window — so a
  // correction the provider publishes after the next week has started (the
  // window now runs to that week's first kickoff, F405) reaches player_stats
  // within the hour and is re-scored while the week is still open. Before
  // this the sweep polled the current week only and such a correction waited
  // for a manual `sync:reingest` (R880).
  // The sweep keys on the injected instant's minute: an invocation delayed
  // past :00:59 skips that hour's refresh — a flex move then lands in ≤ 2 h.
  if (now.getUTCMinutes() === sweepMinute) {
    const { inWindow, finalRepoll, all } = sweepTargets(weeks, currentWeek, now, opts)
    reasons.push(
      `sweep: nothing due; top-of-hour schedule refresh of week ${currentWeek} (flex moves reach nfl_games within the hour, E42)` +
        (inWindow.length > 0 ? `; and week(s) ${inWindow.join(', ')} still inside their stat-correction window (F270 — a late correction is re-scored before the week locks)` : '') +
        (finalRepoll.length > 0
          ? `; and final week(s) ${finalRepoll.join(', ')} — the daily re-poll of weeks locked within ${FINAL_WEEK_REPOLL_DAYS} days (TD5 — a late correction is recorded, never scored)`
          : ''),
    )
    // R1265: the current week first — a throw on an earlier week never skips its refresh.
    return { mode: 'sweep', weeks: all, sweepWeeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  reasons.push(`idle: no in-week game within ${leadMs / 60_000} min of kickoff or still open; next sweep at minute ${sweepMinute} — no provider call`)
  return { mode: 'idle', weeks: [], sweepWeeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
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
  const { data, error } = await db.from('nfl_weeks').select('season, week, starts_at, correction_window_ends_at').eq('season', season).order('week')
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

  let sweepCarried = false
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

    // F509: once a hot round has carried the sweep, this invocation's sweep is
    // done — a later round that plans a sweep (the stuck game observed final
    // mid-invocation) would only repeat it.
    if (plan.mode === 'sweep' && sweepCarried) break
    const carried = plan.mode === 'hot' && !sweepCarried ? plan.sweepWeeks : []
    if (carried.length > 0) sweepCarried = true
    // A round that reads several weeks at one instant for the sweep counts its failures once (R1314).
    const oneInstant = plan.mode === 'sweep' || carried.length > 0

    provider.resetScheduleMemo()
    const round: PollRound = { plan, polls: [] }
    // R1314 (M6 L.E2.1): a SWEEP round reads the provider for up to three
    // weeks at one instant (the current week, F270's open-window weeks,
    // TD5's final weeks), so one provider blip would fail all of them at
    // once. §23.2's "3 failed polls" means three polls in TIME — a sweep's
    // failures count ONCE toward it: after the round's first failed poll,
    // a further failure is not persisted (a success still is — it clears).
    let sweepFailureCounted = false
    for (const week of [...plan.weeks, ...carried]) {
      const tracker = await loadTracker(deps.db)
      const poll = await ingest(provider, deps.time, { db: deps.db, degradation: tracker, season: deps.season, week })
      const alreadyCounted = oneInstant && !poll.ok && sweepFailureCounted
      const flag = alreadyCounted && report.flag !== null ? report.flag : await persist(deps.db, tracker, poll)
      if (oneInstant && !poll.ok) sweepFailureCounted = true
      round.polls.push({ week, report: poll, flag })
      report.flag = flag
      if (alreadyCounted) {
        report.problems.push(`week ${week}: provider poll FAILED again in the same sweep (${poll.error ?? 'unknown'}) — nothing written; counted once per sweep toward stats_degraded (R1314)`)
      } else if (!poll.ok) {
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
