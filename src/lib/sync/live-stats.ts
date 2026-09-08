import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import type {
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'

import { fetchKnownPlayerIds } from './projections'
import type { SyncClient, SyncSummary } from './types'

/** How long after kickoff day a game window stays open (late games, data
 *  settling). Two calendar days covers Sun late + Mon night finalization. */
const WINDOW_MS = 36 * 60 * 60 * 1000

/**
 * Canonical stat key → player_stats column, derived from the STAT_KEYS
 * registry (single source of truth for storage mappings, D20/D24). The seam
 * writes exactly these columns plus the two_point_conversions derivation
 * below — the same surface the pre-seam STAT_MAP wrote (D22).
 */
export const STAT_COLUMN_BY_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  STAT_KEYS.filter((def) => def.storage === 'column' && def.column !== undefined).map(
    (def) => [def.key, def.column as string],
  ),
)

/** The per-type 2-pt keys are column-stored since 057 (D20's M1 work, done —
 *  the registry map above writes them); this summed `two_point_conversions`
 *  derivation continues ALONGSIDE them, byte-identical to the pre-seam
 *  STAT_MAP behavior (D24/D56(4)). Both are written. */
const TWO_POINT_KEYS = ['pass_2pt', 'rush_2pt', 'rec_2pt'] as const

/**
 * Canonical §23.1 stats payload → player_stats column values. Keys without a
 * column mapping are not persisted: storage 'deferred' (awaiting a storage
 * decision, D5) and — since 057 — storage 'derived' (the def_pa/def_ya
 * tier-indicator families, never stored by design, D44). The `advanced`
 * payload is
 * likewise unpersisted until the milestone that adds the JSONB column (D8).
 */
export function toStatColumns(
  stats: ProviderPlayerWeekStats['stats'],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number') continue
    const column = STAT_COLUMN_BY_KEY[key]
    if (column) out[column] = value
  }
  let twoPointSum = 0
  let twoPointSeen = false
  for (const key of TWO_POINT_KEYS) {
    const value = stats[key]
    if (typeof value === 'number') {
      twoPointSum += value
      twoPointSeen = true
    }
  }
  if (twoPointSeen) out.two_point_conversions = twoPointSum
  return out
}

/**
 * Which lingering "live" weeks should be finalized: any week still flagged
 * live that is either behind the current week, or is the current week with
 * its game window closed. Pure — unit tested.
 */
export function weeksToFinalize(
  liveWeeks: number[],
  currentWeek: number,
  inWindow: boolean,
): number[] {
  return liveWeeks.filter((w) => w < currentWeek || (w === currentWeek && !inWindow))
}

/** Fetch + upsert one week's box scores with the given live flag. */
async function ingestWeek(
  supabase: SyncClient,
  provider: StatsProvider,
  season: number,
  week: number,
  isLive: boolean,
  known: Set<string>,
  time: TimeProvider,
): Promise<number> {
  const upserts: Array<Record<string, unknown>> = []
  const rows = await provider.getWeekStats(season, week)
  for (const row of rows) {
    if (!known.has(row.playerId)) continue
    const columns = toStatColumns(row.stats)
    if (Object.keys(columns).length === 0) continue
    upserts.push({
      player_id: row.playerId,
      season,
      week,
      stat_type: 'weekly',
      source: provider.name, // 'sleeper' on the production path (D14)
      is_live: isLive,
      updated_at: time.now().toISOString(), // injected time, never the wall (D12)
      ...columns,
    })
  }

  const BATCH = 500
  let written = 0
  for (let i = 0; i < upserts.length; i += BATCH) {
    const batch = upserts.slice(i, i + BATCH)
    const { error } = await supabase
      .from('player_stats')
      .upsert(batch, { onConflict: 'player_id,season,week' })
    if (error) throw new Error(`stats upsert failed (wk${week}): ${error.message}`)
    written += batch.length
  }
  return written
}

/** Weeks in this season that still carry is_live rows. */
async function lingeringLiveWeeks(
  supabase: SyncClient,
  season: number,
): Promise<number[]> {
  const weeks: number[] = []
  for (let w = 1; w <= 18; w++) {
    const { count, error } = await supabase
      .from('player_stats')
      .select('player_id', { count: 'exact', head: true })
      .eq('season', season)
      .eq('week', w)
      .eq('is_live', true)
    if (error) throw new Error(`live-week scan failed: ${error.message}`)
    if ((count ?? 0) > 0) weeks.push(w)
  }
  return weeks
}

/**
 * GATE-ONLY SINCE L.D2.3 (PROGRESS F216(c), D322 — 2026-09-07). Production's
 * `/api/cron/sync-live` no longer binds this function: it runs
 * `runLivePollInvocation` (`live-poll.ts`) over L.D2.1's `ingestWeek`, which
 * writes `nfl_games`, the `nfl_weeks` bounds, `player_stats(+advanced)` and
 * the `score_fanout` queue — none of which this pre-M4 writer touches.
 * `syncLiveStats` stays byte-identical because the M0 gate golden-pins its
 * upsert sequence (D30's SHA-256 literals over the FixtureReplayProvider
 * replay, `m0-gate.test.ts`); retiring it means re-recording those hashes
 * over `ingestWeek` (D30's own rule) — PROGRESS F266 carries that. Nothing
 * else imports it (`toStatColumns` / `STAT_COLUMN_BY_KEY` above are the
 * registry map `ingestWeek` reuses and stay production code).
 *
 * In-season live/box-score sync, behind the §23.1 StatsProvider contract
 * (L.A0.2b seam). During a game window it upserts the current week's running
 * numbers flagged is_live. Once the window closes (or for any older week
 * still flagged live) it runs one FINAL pass: re-fetches the settled numbers
 * and writes them with is_live=false, so finished games never stay flagged
 * in-progress. Outside the season it's a cheap no-op.
 *
 * All external reads go through `provider`; all time reads through `time`
 * (D3) — so a FixtureReplayProvider + VirtualClock replays this exact path
 * with zero external calls (M0 exit criterion 1).
 */
export async function syncLiveStats(
  supabase: SyncClient,
  provider: StatsProvider,
  season: number,
  currentWeek: number,
  time: TimeProvider,
): Promise<SyncSummary> {
  if (currentWeek < 1 || currentWeek > 18) {
    return { name: 'live-stats', counts: { skipped: 1 }, warnings: ['offseason — skipped'] }
  }

  const games = await provider.getSchedule(season)
  // The window check runs on the day-granularity gameDate (the sleeper tier
  // has no kickoff timestamps — Q1/D25), exactly as the pre-seam code did.
  const weekGames = games.filter((g) => g.week === currentWeek && g.gameDate)
  const inWindow = weekGames.some((g) => {
    const kickoffDay = new Date(`${g.gameDate}T00:00:00Z`).getTime()
    const nowMs = time.now().getTime()
    return nowMs >= kickoffDay && nowMs <= kickoffDay + WINDOW_MS
  })

  // Finalize any weeks still flagged live whose window is behind us.
  const liveWeeks = await lingeringLiveWeeks(supabase, season)
  const finalize = weeksToFinalize(liveWeeks, currentWeek, inWindow)

  if (!inWindow && finalize.length === 0) {
    return {
      name: 'live-stats',
      counts: { skipped: 1 },
      warnings: [`week ${currentWeek}: no game window open — skipped`],
    }
  }

  const known = await fetchKnownPlayerIds(supabase)
  const counts: Record<string, number> = {}

  for (const week of finalize) {
    counts[`finalized-wk${week}`] = await ingestWeek(
      supabase,
      provider,
      season,
      week,
      false,
      known,
      time,
    )
  }
  if (inWindow) {
    counts[`live-wk${currentWeek}`] = await ingestWeek(
      supabase,
      provider,
      season,
      currentWeek,
      true,
      known,
      time,
    )
  }

  return { name: 'live-stats', counts, warnings: [] }
}
