/**
 * reingest-weeks — re-poll PAST weeks through the production ingestion
 * (`ingestWeek`), for the ops step migration 143 leaves behind (M6A task
 * L.E1.26 fix round, R1149; PROGRESS F390 / F400 / D380(11)).
 *
 * WHY IT EXISTS. 143 NULLs every never-ingested `def_yards_allowed` 0 ("not
 * delivered"), and nothing re-polls a completed week: the live poll plans
 * HOT weeks and the hourly sweep polls only the current calendar week
 * (`live-poll.ts`). Until a completed week is re-ingested, every D/ST
 * starter of that week under a template that scores yards allowed (Scout
 * Standard — the default every new league starts on — Scout PPR, ESPN
 * Standard / PPR) reads PENDING in the box score next to a stored final
 * score, and the nightly reconcile raises `pending_vs_stored` for every such
 * cell (F400). This re-polls those weeks so the column holds Sleeper's value.
 *
 * WHAT ONE RUN DOES, per requested week, in order:
 *   1. REFUSE the whole run before any provider call if ANY requested week
 *      has not started — no `nfl_weeks` row, or `first_kickoff_at` NULL or
 *      after now (the injected clock). A week in progress
 *      (`last_game_ends_at` NULL) is allowed and named: the live poll covers
 *      it too, and both are diffs.
 *   2. `ingestWeek(provider, time, { db, degradation, season, week })` —
 *      L.D2.1's writer, untouched: provider reads before any write, a DIFF
 *      (an identical re-poll writes and enqueues nothing — D380(5) R4),
 *      every upsert count-asserted, every read paged past the 1000-row cap.
 *      A fresh `DegradationTracker` per run: this tool never touches
 *      `system_flags` (the live poll's `stats_degraded` / `ingest_poll`
 *      keys are not its to write).
 *   3. COUNT, loudly: rows inserted / updated / unchanged, unknown ids,
 *      deltas enqueued; the week's D/ST rows read before and after (paged):
 *      how many had their yards filled or changed, how many carry yards, and
 *      WHICH do not. Rows updated beyond the D/ST yards are said, not
 *      hidden — a re-poll of a past week also lands any stat correction
 *      Sleeper made since the week's last poll.
 *
 * WHAT THE ENQUEUED DELTAS DO. The score-week worker drains them: a league
 * week that is `final` consumes them as `week_final` and changes NO league
 * cell (Q64 / D295(b)); a `live` / `correction_window` week re-scores its
 * affected teams with the real yards (the law). The stored final scores of
 * weeks re-ingested after their correction window therefore keep the +5
 * they were paid, while the box score and the reconcile recompute the real
 * tier — reconcile reads that as `post_window_correction` (a WARN naming the
 * delta, then unchecked for that cell — F268), and the stored-vs-recomputed
 * difference itself is F397's question, not this tool's.
 *
 * FAILURE IS LOUD: `ok` is false (and the CLI exits 1) when a refusal, a
 * provider failure or a DB error occurs, or when a COMPLETED week
 * (`last_game_ends_at` set) still has a D/ST row with NULL yards after the
 * re-poll — every completed line measured carries the value (D380(2)).
 *
 * Time only via `time`; provider reads only via `provider` (bound by the
 * CLI, `scripts/reingest-weeks.ts` — the same composite the cron route
 * binds). No `fetch` here.
 */

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { StatsProvider } from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { pageAll } from '@/lib/supabase/page-all'

import { ingestWeek, type IngestReport } from './ingest-week'
import type { SyncClient } from './types'

export interface ReingestOptions {
  season: number
  /** Ascending, de-duplicated, each 1–18 (`parseWeeks`). */
  weeks: number[]
}

export interface ReingestWeekReport {
  week: number
  /** `last_game_ends_at` was set when the run started. */
  completed: boolean
  ingest: IngestReport
  /** D/ST rows whose `def_yards_allowed` was filled or changed by this re-poll (a new row counts). */
  dstYardsChanged: number
  /** D/ST (`players.position = 'DEF'`) rows stored for the week after the re-poll. */
  dstRows: number
  dstWithYards: number
  /** D/ST ids whose row still holds NULL yards after the re-poll. */
  dstWithoutYards: string[]
  problems: string[]
}

export interface ReingestReport {
  season: number
  ok: boolean
  /** Set when the run was refused before any provider call. */
  refused?: string
  weeks: ReingestWeekReport[]
}

export interface ReingestDeps {
  db: SyncClient
  provider: StatsProvider
  time: TimeProvider
}

/** `"1-3"`, `"1,2,5"`, `"1-2,4"` → ascending unique weeks; throws on anything else. */
export function parseWeeks(spec: string): number[] {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!m) throw new Error(`Invalid --weeks "${spec}" — use e.g. 1-3 or 1,2,4`)
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < 1 || to > 18 || from > to) throw new Error(`Invalid --weeks "${spec}" — weeks run 1–18, low to high`)
    for (let w = from; w <= to; w++) out.add(w)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The target guard (R1149): the CLI loads `.env.local`, which names the
 * HOSTED project — so a run must NAME the host it expects. Returns the host
 * when `confirm` equals it; throws a message that prints the host otherwise.
 */
export function confirmTarget(supabaseUrl: string, confirm: string | undefined): string {
  let host: string
  try {
    host = new URL(supabaseUrl).host
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${supabaseUrl}`)
  }
  if (confirm === undefined) {
    throw new Error(`target is ${host} — re-run with --confirm-target ${host} to write to it`)
  }
  if (confirm !== host) {
    throw new Error(`--confirm-target ${confirm} does not match the target ${host} — nothing written`)
  }
  return host
}

interface WeekRow {
  week: number
  first_kickoff_at: string | null
  last_game_ends_at: string | null
}

async function readWeeks(db: SyncClient, season: number, weeks: number[]): Promise<Map<number, WeekRow>> {
  const rows = await pageAll<WeekRow>((from, to) =>
    db
      .from('nfl_weeks')
      .select('week, first_kickoff_at, last_game_ends_at', { count: 'exact' })
      .eq('season', season)
      .in('week', weeks)
      .order('week')
      .range(from, to),
  )
  return new Map(rows.map((r) => [r.week, r]))
}

async function readDefenseIds(db: SyncClient): Promise<Set<string>> {
  const rows = await pageAll<{ id: string }>((from, to) =>
    db.from('players').select('id', { count: 'exact' }).eq('position', 'DEF').order('id').range(from, to),
  )
  return new Set(rows.map((r) => r.id))
}

async function readDefenseYards(
  db: SyncClient,
  season: number,
  week: number,
  defenseIds: Set<string>,
): Promise<Array<{ player_id: string; def_yards_allowed: number | null }>> {
  if (defenseIds.size === 0) return []
  return pageAll<{ player_id: string; def_yards_allowed: number | null }>((from, to) =>
    db
      .from('player_stats')
      .select('player_id, def_yards_allowed', { count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .in('player_id', [...defenseIds])
      .order('player_id')
      .range(from, to),
  )
}

/** Pre-flight: every requested week must have started (refusal names each one). */
export function refusalFor(weeks: number[], rows: ReadonlyMap<number, WeekRow>, now: Date): string | null {
  const bad: string[] = []
  for (const week of weeks) {
    const row = rows.get(week)
    if (!row) bad.push(`week ${week}: no nfl_weeks row`)
    else if (row.first_kickoff_at === null) bad.push(`week ${week}: no game has a recorded kickoff (first_kickoff_at NULL) — not started`)
    else if (new Date(row.first_kickoff_at).getTime() > now.getTime()) bad.push(`week ${week}: first kickoff ${row.first_kickoff_at} is after now — not started`)
  }
  return bad.length === 0 ? null : `refused — ${bad.join('; ')}. Nothing was polled or written.`
}

export async function reingestWeeks(deps: ReingestDeps, opts: ReingestOptions): Promise<ReingestReport> {
  const { db, provider, time } = deps
  const { season, weeks } = opts
  if (weeks.length === 0) throw new Error('reingestWeeks: no weeks requested')

  const calendar = await readWeeks(db, season, weeks)
  const refused = refusalFor(weeks, calendar, time.now())
  if (refused !== null) return { season, ok: false, refused, weeks: [] }

  const defenseIds = await readDefenseIds(db)
  if (defenseIds.size === 0) throw new Error('players has no position = DEF rows — cannot count D/ST yards (refusing to call that success)')

  const report: ReingestReport = { season, ok: true, weeks: [] }
  for (const week of weeks) {
    const completed = calendar.get(week)!.last_game_ends_at !== null
    const before = new Map((await readDefenseYards(db, season, week, defenseIds)).map((r) => [r.player_id, r.def_yards_allowed]))
    const ingest = await ingestWeek(provider, time, { db, degradation: new DegradationTracker(), season, week })
    const after = await readDefenseYards(db, season, week, defenseIds)
    const problems: string[] = []
    if (!ingest.ok) problems.push(`ingest failed: ${ingest.error ?? 'unknown'} — nothing written for week ${week} (§23.2)`)

    const dstYardsChanged = after.filter((r) => !before.has(r.player_id) || before.get(r.player_id) !== r.def_yards_allowed).length
    const dstWithoutYards = after.filter((r) => r.def_yards_allowed === null).map((r) => r.player_id)
    if (ingest.ok && completed && dstWithoutYards.length > 0) {
      problems.push(`completed week ${week} still has ${dstWithoutYards.length} D/ST row(s) with NULL yards after the re-poll: ${dstWithoutYards.join(', ')} — Sleeper's line carried neither yds_allow nor yds_allow_0_100`)
    }
    if (ingest.ok && completed && after.length === 0) {
      problems.push(`completed week ${week} has ZERO D/ST rows after the re-poll — refusing to call that success`)
    }
    if (problems.length > 0) report.ok = false
    report.weeks.push({
      week,
      completed,
      ingest,
      dstYardsChanged,
      dstRows: after.length,
      dstWithYards: after.length - dstWithoutYards.length,
      dstWithoutYards,
      problems,
    })
  }
  return report
}

/** One line per week, for the CLI. */
export function renderReingest(report: ReingestReport): string[] {
  if (report.refused) return [`REFUSED [${report.season}]: ${report.refused}`]
  const lines: string[] = []
  for (const w of report.weeks) {
    const s = w.ingest.stats
    lines.push(
      `  week ${w.week} ${w.problems.length === 0 ? 'OK  ' : 'FAIL'}${w.completed ? '' : ' (IN PROGRESS — the live poll covers it too)'} ` +
        `rows: inserted=${s.inserted} updated=${s.updated} metaOnly=${s.metaOnly} unchanged=${s.unchanged} ` +
        `D/ST yards filled/changed=${w.dstYardsChanged} ` +
        `unknownIds=${s.unknownPlayer} empty=${s.empty} | deltas enqueued=${s.enqueued} restamped=${s.restamped} | ` +
        `D/ST yards: ${w.dstWithYards}/${w.dstRows}${w.dstWithoutYards.length > 0 ? ` — NULL: ${w.dstWithoutYards.join(', ')}` : ''}`,
    )
    for (const r of w.ingest.reasons) lines.push(`      ${r}`)
    for (const p of w.problems) lines.push(`      PROBLEM: ${p}`)
  }
  return lines
}
