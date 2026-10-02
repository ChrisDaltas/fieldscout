/**
 * F558 / F559 — a scoped job call the sim can trust to have VISITED its league.
 *
 * Every league job (`lineup_lock_tick`, `league_week_advance`,
 * `finalize_matchups`, `waiver_tick`, `trade_tick`) takes its leagues
 * `FOR UPDATE SKIP LOCKED`. The local stack's pg_cron runs the same jobs
 * UNSCOPED at wall-clock `now()` every minute; for a season-2099 league it
 * finds nothing due, but `lineup_lock_tick()` (and the advance job) still
 * LOCK every in-season league row while they look. A sim call at a virtual
 * instant that lands inside that window skips the league and returns a
 * perfectly well-formed report that visited NOTHING — which the sim used to
 * read as "the job ran and had nothing to do" (CLAUDE.md, "never let nothing
 * happened mean it worked"). In production the next minute's tick catches up
 * (that is what SKIP LOCKED is for), so this is the harness's defect, not the
 * product's.
 *
 * The fix is the production behaviour, compressed: re-run the SAME call at the
 * SAME virtual instant until the job says it visited the league, and fail
 * LOUD (naming the job, league and instant) if it never does. `visited` is the
 * job's own word; `inScope` is asked only when the job did not visit, and says
 * whether the league SHOULD have been visited (a league legitimately out of a
 * job's scope is accepted after the first call, exactly as before).
 */
export interface ScopedJobOptions<R> {
  /** What the call is, for the loud failure. */
  label: string
  call: () => Promise<R>
  /** The job's own report says it reached this league. */
  visited: (report: R) => boolean
  /** Asked only when not visited: must this league have been visited? */
  inScope: () => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  /** Attempts in all (default 60 × 250 ms ≈ 15 s — far above any cron tick). */
  attempts?: number
  delayMs?: number
}

export interface ScopedJobResult<R> {
  report: R
  /** Calls that came back without visiting a league in scope (skipped on a lock). */
  skippedOnLock: number
}

export async function runScopedJob<R>(o: ScopedJobOptions<R>): Promise<ScopedJobResult<R>> {
  const attempts = o.attempts ?? 60
  const delayMs = o.delayMs ?? 250
  let skippedOnLock = 0
  for (let i = 0; i < attempts; i++) {
    const report = await o.call()
    if (o.visited(report)) return { report, skippedOnLock }
    if (!(await o.inScope())) return { report, skippedOnLock }
    skippedOnLock += 1
    if (i < attempts - 1) await o.sleep(delayMs)
  }
  throw new Error(
    `${o.label}: the job never visited the league in ${attempts} call(s) although it is in the job's scope — ` +
      `its row stayed locked (FOR UPDATE SKIP LOCKED) for ${(attempts * delayMs) / 1000}s (F558)`,
  )
}

/** `leagues` as the five jobs report it (the count of leagues the pass visited). */
export function reportVisitedLeagues(report: unknown): number {
  const n = Number((report as { leagues?: unknown } | null)?.leagues)
  return Number.isFinite(n) ? n : 0
}
