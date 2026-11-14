/**
 * live-poll — the production `sync-live` invocation (task L.D2.3; spec §14
 * "live stats ingestion" / §23.2 "poll cadence 20–30s in game windows" /
 * §23.3 "no code ever infers the current week from wall-clock math" /
 * E45; PROGRESS D322; discharges F216 (the rebind), binds F217 (the
 * persisted flag) and F238's release WRITER — the scheduled poll that
 * observes a week all-final and stamps `nfl_weeks.last_game_ends_at`).
 *
 * WHO WAKES IT, AND HOW OFTEN — migration 224 (Chris 2026-11-14: "The
 * games are only played on Thursday for a couple hours, and Sunday for a
 * couple hours, and Monday for a couple hours. So why are we looking
 * constantly all the time?" — "how about every 30 seconds during games" —
 * "but how about once a day on none day games?" — "once the score is final
 * the game is over."). The DATABASE decides: pg_cron's `sync-live-ping` job
 * runs every 30 s and calls this route (`?sweep=none`) only while a game
 * window is open — `public.live_game_window_open`, this file's HOT rule
 * restated in SQL (pinned equal in `live-poll-window-db.test.ts`); the
 * `sync-live-sweep` job calls it once a day at 11:00Z (`?sweep=daily`).
 * Every invocation does ONE round and exits — no sleep loop, because a
 * sleeping Vercel function is billed for the wait (the Hobby account was
 * paused 2026-11-11 for that). A caller with no `sweep` parameter — 124's
 * per-minute ping, still live until 224 is pushed — gets the pre-224
 * hourly sweep (`'hourly'`, the named fallback; F-row in PROGRESS).
 *
 * WHAT ONE INVOCATION DOES:
 *
 *   1. PLAN from the tables, never the clock alone (`planLivePoll`): read
 *      the season's `nfl_games` + `nfl_weeks` and decide —
 *        * HOT  — some in-week game (`scheduled` | `live`) has a kickoff
 *                 at or before now + `POLL_LEAD_MS`, and has NOT been
 *                 observed `final`: poll every week that has one. The
 *                 window CLOSES ON OBSERVATION, not on the clock (F216's
 *                 R711 amendment): a game that kicked off hours ago and is
 *                 still `live`/`scheduled` in the table keeps the week hot
 *                 until a poll sees it `final` — which is the poll that
 *                 stamps `last_game_ends_at` (F238's writer). Once it reads
 *                 `final` it is over: it never keeps a window open again
 *                 (Chris 2026-11-14), and 224's database gate stops waking
 *                 this route on the very next tick. The cost of a game the
 *                 provider never flips (Q37's cancelled game) is one poll
 *                 per 30-second wake (each a fresh ~2 MB nflverse CSV
 *                 read), said in the plan; the reconciliation names it
 *                 (`game_not_final_late` — an ALERT once the week is past
 *                 its correction window and can no longer finalize).
 *                 When the sweep is due a HOT plan also CARRIES it
 *                 (`sweepWeeks`, F509): the weeks below that are not
 *                 already hot are polled once in the invocation, so a
 *                 stuck game never starves the sweep or the re-polls.
 *        * SWEEP — nothing due, but the sweep is due (see `SweepMode`:
 *                 `'daily'` — the caller is 224's once-a-day 11:00Z job;
 *                 `'hourly'` — the pre-224 fallback, minute 0 of the
 *                 injected instant) OR the season has NO game rows at all
 *                 (F228's shape — the calendar is empty and the composite
 *                 provider's nflverse half can fill it): ONE poll of the
 *                 current calendar week (the greatest `nfl_weeks.starts_at
 *                 <= now`, clamped to week 1 before the season), so
 *                 schedule changes (flex moves, E42) reach `nfl_games`
 *                 with no game in progress — PLUS every earlier week still
 *                 inside its stat-correction window (F270, closed by M5
 *                 L.D3.11: a late correction is ingested and re-scored
 *                 before the week locks) — PLUS, on the daily sweep (or the
 *                 hourly fallback's FINAL_WEEK_REPOLL_UTC_HOUR sweep), every
 *                 week whose window closed within FINAL_WEEK_REPOLL_DAYS
 *                 (TD5, M6 L.E2.1: once a day for 7 days after it locks, so
 *                 a late correction is RECORDED — `stat_correction_events`
 *                 — and research stays right; the worker consumes its
 *                 deltas as `week_final` and no score moves).
 *        * IDLE — nothing due and no sweep due: return without a provider
 *                 call, the reason named.
 *   2. POLL — `ingestWeek(provider, time, { db, degradation, season,
 *      week })` per planned week (L.D2.1's writer, untouched), the tracker
 *      loaded from and persisted to `system_flags` around every poll
 *      (`ingest-flags.ts` — F217), the week's `ingest_poll` key stamped
 *      after a successful one (F218/R714's orphan escape datum). The
 *      provider's season-wide schedule read (the ~2 MB nflverse CSV, F216)
 *      is memoized for the round — every week in it shares one read.
 *   3. EXIT. One round per invocation; the next round is the next wake.
 *
 * The provider is BOUND BY THE ROUTE (D300 — never in here): production
 * passes `withNflverseCalendar(new SleeperStatsProvider(systemTime), new
 * NflverseProvider(systemTime))`; tests pass a fake. Time only via `time`
 * (the D3 fence covers this file).
 */

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { pageAll } from '@/lib/supabase/page-all'

import { type FlagsClient, loadDegradationTracker, persistPollOutcome, type StatsDegradedFlag } from './ingest-flags'
import { failedPollReport, ingestWeek, pollFailureCounted, type IngestReport } from './ingest-week'

// ── Constants (the route pins them beside `maxDuration`) ───────────────────

/** Poll from this long before a kickoff: inactives / status flips land pre-game. 224's `live_game_window_open` uses the same 15 minutes. */
export const POLL_LEAD_MS = 15 * 60_000
/** 224's in-window cadence — the `sync-live-ping` job's `'30 seconds'` schedule (§23.2's "20–30s"; Chris 2026-11-14). The route test pins it against the migration text. */
export const LIVE_WAKE_SECONDS = 30
/** The pre-224 fallback's sweep minute (`'hourly'` mode only). */
export const SWEEP_MINUTE = 0
/** TD5 (M6 L.E2.1): a FINAL week (its correction window closed) is re-polled
 *  once a day for this many days after it locks, so a late correction is
 *  recorded (`stat_correction_events`) and research stays right. Nothing it
 *  finds changes a score: the worker consumes a final week's deltas as
 *  `week_final` (D295(b)) and the scoring door refuses the week (158). */
export const FINAL_WEEK_REPOLL_DAYS = 7
/** …at the sweep of this UTC hour (11:00Z = 07:00 ET / 06:00 EST — before the
 *  11:15Z reconcile, which then sees the morning's re-poll). 224's daily
 *  `sync-live-sweep` job runs at this hour, so the one daily sweep carries the
 *  re-poll. */
export const FINAL_WEEK_REPOLL_UTC_HOUR = 11

/**
 * Who decides that a sweep is due (224):
 *   * `'daily'`  — the caller says so: 224's once-a-day `sync-live-sweep` job
 *                  (`?sweep=daily`, 11:00Z). Includes TD5's final-week re-poll.
 *   * `'none'`   — never sweep: 224's 30-second game-window wake
 *                  (`?sweep=none`). A HOT plan polls the hot weeks only.
 *   * `'hourly'` — no parameter: the pre-224 per-minute ping (124), live until
 *                  224 is pushed — minute 0 of every hour, TD5 at 11:00Z.
 *                  Kept so a merge before the push changes nothing it can't
 *                  carry (124's stall check still expects an hourly ingest).
 */
export type SweepMode = 'daily' | 'none' | 'hourly'

/** The route's `?sweep=` → a SweepMode. Absent (null) → `'hourly'`, the pre-224 fallback; anything but `daily` / `none` → null, which the route refuses (400) rather than guesses. */
export function parseSweepMode(raw: string | null): SweepMode | null {
  if (raw === null) return 'hourly'
  return raw === 'daily' || raw === 'none' ? raw : null
}


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
  /** Who decides that a sweep is due (224); default `'hourly'` — the pre-224 fallback for a caller that names none. */
  sweep?: SweepMode
  /** `'hourly'` only: the sweep minute; default SWEEP_MINUTE. */
  sweepMinute?: number
  /** `'hourly'` only: TD5's daily re-poll hour (UTC); default FINAL_WEEK_REPOLL_UTC_HOUR. (`'daily'` always carries the re-poll.) */
  finalRepollHourUtc?: number
}

/** The statuses that keep a window open. `final` is over (Chris 2026-11-14: "once the score is final the game is over"); `postponed` waits for its new kickoff. 224's `live_game_window_open` lists the same two (pinned in `live-poll-window-db.test.ts`). */
export const OPEN_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'live'])

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

/** Is the sweep due at `now` under `opts.sweep` (224)? `'daily'`: yes — the
 *  caller is the daily job; `'none'`: never; `'hourly'` (the pre-224
 *  fallback): on the sweep minute of the injected instant. */
function sweepDue(now: Date, opts: PlanOptions): boolean {
  const mode = opts.sweep ?? 'hourly'
  if (mode === 'daily') return true
  if (mode === 'none') return false
  return now.getUTCMinutes() === (opts.sweepMinute ?? SWEEP_MINUTE)
}

/** The sweep's weeks at `now` (a sweep is due): the current week first
 *  (R1265), then F270's open-window weeks, then — on the daily sweep, or at
 *  TD5's hour under the hourly fallback — the weeks locked within
 *  FINAL_WEEK_REPOLL_DAYS. Shared by the sweep and the hot plan that carries
 *  it (F509). */
function sweepTargets(weeks: readonly CalendarWeek[], currentWeek: number, now: Date, opts: PlanOptions) {
  const inWindow = weeksInCorrectionWindow(weeks, currentWeek, now)
  // TD5 (M6 L.E2.1): once a day, each week locked within the last
  // FINAL_WEEK_REPOLL_DAYS days too — its late corrections are RECORDED
  // (stat_correction_events) and player_stats stays right for research;
  // no score moves (the worker's week_final, 158's lock). Under 224 the one
  // daily sweep IS that once a day.
  const repollToday =
    (opts.sweep ?? 'hourly') === 'daily' || now.getUTCHours() === (opts.finalRepollHourUtc ?? FINAL_WEEK_REPOLL_UTC_HOUR)
  const finalRepoll = repollToday ? finalWeeksForRepoll(weeks, currentWeek, now).filter((w) => !inWindow.includes(w)) : []
  return { inWindow, finalRepoll, all: [currentWeek, ...inWindow, ...finalRepoll] }
}

export function planLivePoll(games: readonly CalendarGame[], weeks: readonly CalendarWeek[], now: Date, opts: PlanOptions = {}): PollPlan {
  const leadMs = opts.leadMs ?? POLL_LEAD_MS
  const mode = opts.sweep ?? 'hourly'
  const sweepIsDue = sweepDue(now, opts)
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
    // before the sweep, so the schedule refresh, F270's re-poll of weeks still
    // inside their correction window and TD5's daily re-poll of final weeks
    // all waited for that game. When the sweep is due the hot plan now
    // CARRIES it: every week the sweep would poll that is not already hot
    // (`sweepWeeks`), polled once in the invocation. Nothing here decides
    // what a stuck game IS (Q37 / E43 rule that) — it only stops one from
    // starving the other weeks.
    const sweepWeeks = sweepIsDue ? sweepTargets(weeks, currentWeek, now, opts).all.filter((w) => !dueWeeks.includes(w)) : []
    if (sweepWeeks.length > 0) {
      reasons.push(
        `sweep carried on a hot invocation (F509): week(s) ${sweepWeeks.join(', ')} — the ${mode} sweep and the re-polls never wait for a game not yet observed final`,
      )
    }
    return { mode: 'hot', weeks: dueWeeks, sweepWeeks, dueGames: due.length, openPastKickoff, currentWeek, reasons }
  }

  // F228 — except on 224's game-window wake (`'none'`), which never sweeps:
  // with no game rows that wake never comes, and the daily sweep lands them.
  if (games.length === 0 && mode !== 'none') {
    reasons.push(`sweep: the season has NO nfl_games rows — polling week ${currentWeek} so the provider's calendar can land (F228)`)
    return { mode: 'sweep', weeks: [currentWeek], sweepWeeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  // F270 CLOSED (M5 L.D3.11, R1260): the sweep re-polls the CURRENT week AND
  // every earlier week still inside its stat-correction window — so a
  // correction the provider publishes after the next week has started (the
  // window now runs to that week's first kickoff, F405) reaches player_stats
  // by the next sweep and is re-scored while the week is still open. Before
  // this the sweep polled the current week only and such a correction waited
  // for a manual `sync:reingest` (R880). Under 224 that sweep is DAILY
  // (Chris 2026-11-14: "how about once a day on none day games?").
  // The hourly fallback keys on the injected instant's minute: an invocation
  // delayed past :00:59 skips that hour's refresh. The daily sweep keys on
  // its caller, so a late wake still sweeps.
  if (sweepIsDue) {
    const { inWindow, finalRepoll, all } = sweepTargets(weeks, currentWeek, now, opts)
    reasons.push(
      `sweep: nothing due; ${mode} schedule refresh of week ${currentWeek} (flex moves reach nfl_games by the next sweep, E42)` +
        (inWindow.length > 0 ? `; and week(s) ${inWindow.join(', ')} still inside their stat-correction window (F270 — a late correction is re-scored before the week locks)` : '') +
        (finalRepoll.length > 0
          ? `; and final week(s) ${finalRepoll.join(', ')} — the daily re-poll of weeks locked within ${FINAL_WEEK_REPOLL_DAYS} days (TD5 — a late correction is recorded, never scored)`
          : ''),
    )
    // R1265: the current week first — a throw on an earlier week never skips its refresh.
    return { mode: 'sweep', weeks: all, sweepWeeks: [], dueGames: 0, openPastKickoff: 0, currentWeek, reasons }
  }
  reasons.push(
    `idle: no in-week game within ${leadMs / 60_000} min of kickoff or still open; ${
      mode === 'hourly' ? `next sweep at minute ${opts.sweepMinute ?? SWEEP_MINUTE}` : `next sweep at the daily ${FINAL_WEEK_REPOLL_UTC_HOUR}:00Z run`
    } — no provider call`,
  )
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
  season: number
  /** Injectable for the invocation's tests; production passes nothing (ingestWeek). */
  ingest?: typeof ingestWeek
  /** Injectable for the invocation's tests. */
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
  /** At most ONE round (224: one round per invocation, the next round is the next wake); empty when idle. */
  rounds: PollRound[]
  /** The final flag after the last poll (null when idle — nothing polled). */
  flag: StatsDegradedFlag | null
  /** Every loud thing, one line each. */
  problems: string[]
  /** Why nothing was polled — never an empty success by default. */
  reason: 'idle' | null
}

export async function runLivePollInvocation(deps: LivePollDeps): Promise<LivePollInvocationReport> {
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

  // ONE ROUND (224). The 30-second cadence lives in the database's schedule;
  // a sleep here would be billed for its whole wait.
  {
    const now = deps.time.now()
    const calendar = await readCalendar(deps.db, deps.season)
    const plan = planLivePoll(calendar.games, calendar.weeks, now, deps.planOptions)
    if (plan.mode === 'idle') {
      report.reason = 'idle'
      report.problems.push(`polled nothing: ${plan.reasons.join('; ')}`)
      report.finished_at = deps.time.now().toISOString()
      return report
    }

    // F509: a hot round carries the sweep when one is due.
    const carried = plan.mode === 'hot' ? plan.sweepWeeks : []
    // A round that reads several weeks at one instant for the sweep counts its failures once (R1314).
    const oneInstant = plan.mode === 'sweep' || carried.length > 0

    provider.resetScheduleMemo()
    const round: PollRound = { plan, polls: [] }
    // ONE ROUND, ONE OUTCOME (R1314, M6 L.E2.1; R1740, M7 L.F2.3). A round
    // reads the provider for its weeks at one instant, and §23.2's "3 failed
    // polls" means three polls in TIME — so the round, not each week, is what
    // counts: every week is polled against the count as it stood when the
    // round began (a scratch tracker each), and the round's outcome is the
    // WORST of them — any failed week ⇒ the count rises (once: two failed
    // weeks are one failed instant), only an all-success round clears it. A
    // success on one week therefore never clears a failure on another, in
    // either order, so a week that fails every round raises the flag on the
    // third round however its neighbours fare.
    const base = (await loadTracker(deps.db)).consecutiveFailures
    const polled: Array<{ week: number; poll: IngestReport; scratch: DegradationTracker }> = []
    for (const week of [...plan.weeks, ...carried]) {
      const scratch = new DegradationTracker(base)
      let poll: IngestReport
      try {
        poll = await ingest(provider, deps.time, { db: deps.db, degradation: scratch, season: deps.season, week })
      } catch (err) {
        // F832 (M7 L.F2.3): a poll that fails AFTER the provider answered (a
        // door refusal, a database error) is a FAILED POLL — counted toward
        // stats_degraded (once: `ingestWeek` marks what it already counted),
        // persisted, named — and the round's other weeks are still polled.
        if (!pollFailureCounted(err)) scratch.recordPollResult(false)
        poll = failedPollReport(provider.name, deps.season, week, deps.time.now(), scratch.degraded, err instanceof Error ? err.message : String(err))
      }
      polled.push({ week, poll, scratch })
    }
    const failedPolls = polled.filter((p) => !p.poll.ok)
    const roundCount = failedPolls.length === 0 ? 0 : Math.max(...failedPolls.map((p) => p.scratch.consecutiveFailures))
    // Successes persist first (each writes its week's last-poll instant), the
    // failures last — so the flag's final write names the failure.
    const ordered = [...polled.filter((p) => p.poll.ok), ...failedPolls]
    const flags = new Map<number, StatsDegradedFlag>()
    for (const p of ordered) flags.set(p.week, await persist(deps.db, new DegradationTracker(roundCount), p.poll))
    let failuresNamed = 0
    for (const { week, poll } of polled) {
      const flag = flags.get(week)!
      round.polls.push({ week, report: poll, flag })
      report.flag = flags.get(ordered[ordered.length - 1]!.week)!
      if (!poll.ok && failuresNamed > 0) {
        report.problems.push(
          oneInstant
            ? `week ${week}: provider poll FAILED again in the same sweep (${poll.error ?? 'unknown'}) — nothing written; counted once per sweep toward stats_degraded (R1314)`
            : `week ${week}: provider poll FAILED again in the same round (${poll.error ?? 'unknown'}) — counted once per round toward stats_degraded (R1740)`,
        )
      } else if (!poll.ok) {
        failuresNamed += 1
        // F832 / R1744: a failure AFTER the provider answered may have
        // written part of the poll (new games; the lines of the batches
        // before the failing one) — what is CERTAINLY withheld is the week's
        // completion: its games' moves to final and its last-game stamp.
        const afterAnswer = poll.reasons.some((r) => r.startsWith('poll failed after the provider answered'))
        report.problems.push(
          `week ${week}: ${afterAnswer ? 'poll FAILED after the provider answered' : 'provider poll FAILED'} (${poll.error ?? 'unknown'}) — ${afterAnswer ? "some writes may have landed (new games, lines before the failing batch); the week's moves to final and its completion stamp were withheld" : 'nothing written'}; consecutive failures ${flag.consecutive_failures}${flag.degraded ? ' — stats_degraded RAISED (§23.2/E45)' : ''}`,
        )
      } else {
        // A successful poll that could not write the calendar is said out
        // loud (F228: a kickoff-less tier writes no nfl_games — never quiet).
        for (const reason of poll.reasons) {
          // F830 / R1716: a repeated provider row is written once, and said out loud.
          // F916: the provider's lines not kept (a write error) is said out loud too — the scores stand.
          if (reason.startsWith('nfl_games untouched') || reason.startsWith('provider returned zero games') || poll.stats.duplicates > 0 && reason.startsWith('player_stats: ') || reason.startsWith('player_stat_lines: write FAILED')) {
            report.problems.push(`week ${week}: ${reason}`)
          }
        }
      }
    }
    report.rounds.push(round)
  }

  report.finished_at = deps.time.now().toISOString()
  return report
}
