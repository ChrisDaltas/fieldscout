import { fetchKnownPlayerIds } from './projections'
import { fetchSchedule } from './schedule'
import type { SyncClient, SyncSummary } from './types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/** How long after kickoff day a game window stays open (late games, data
 *  settling). Two calendar days covers Sun late + Mon night finalization. */
const WINDOW_MS = 36 * 60 * 60 * 1000

interface SleeperWeeklyStatsRow {
  player_id: string
  stats: Record<string, number | null> | null
}

/** Sleeper actual-stat keys → player_stats columns. Values are summed when
 *  multiple Sleeper keys feed one column (2-point conversions). */
const STAT_MAP: Record<string, string[]> = {
  pass_attempts: ['pass_att'],
  pass_completions: ['pass_cmp'],
  pass_yards: ['pass_yd'],
  pass_tds: ['pass_td'],
  interceptions: ['pass_int'],
  sacks_taken: ['pass_sack'],
  rush_attempts: ['rush_att'],
  rush_yards: ['rush_yd'],
  rush_tds: ['rush_td'],
  fumbles_lost: ['fum_lost'],
  targets: ['rec_tgt'],
  receptions: ['rec'],
  receiving_yards: ['rec_yd'],
  receiving_tds: ['rec_td'],
  two_point_conversions: ['pass_2pt', 'rush_2pt', 'rec_2pt'],
  fg_made: ['fgm'],
  fg_attempted: ['fga'],
  fg_made_40_plus: ['fgm_40_49'],
  fg_made_50_plus: ['fgm_50p'],
  xp_made: ['xpm'],
  xp_attempted: ['xpa'],
  def_sacks: ['sack'],
  def_interceptions: ['int'],
  def_fumble_recoveries: ['fum_rec'],
  def_tds: ['def_td'],
  def_safeties: ['safe'],
  def_points_allowed: ['pts_allow'],
}

function mapStats(stats: Record<string, number | null> | null): Record<string, number> {
  const out: Record<string, number> = {}
  if (!stats) return out
  for (const [column, keys] of Object.entries(STAT_MAP)) {
    let sum = 0
    let seen = false
    for (const key of keys) {
      const v = Number(stats[key] ?? NaN)
      if (Number.isFinite(v)) {
        sum += v
        seen = true
      }
    }
    if (seen) out[column] = sum
  }
  return out
}

async function fetchWeekStats(
  season: number,
  week: number,
  position: string,
): Promise<SleeperWeeklyStatsRow[]> {
  const url = `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&position[]=${position}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Weekly stats fetch failed (${position} wk${week}): ${res.status}`)
  }
  return (await res.json()) as SleeperWeeklyStatsRow[]
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
  season: number,
  week: number,
  isLive: boolean,
  known: Set<string>,
): Promise<number> {
  const upserts: Array<Record<string, unknown>> = []
  for (const pos of POSITIONS) {
    const rows = await fetchWeekStats(season, week, pos)
    for (const row of rows) {
      if (!known.has(row.player_id)) continue
      const mapped = mapStats(row.stats)
      if (Object.keys(mapped).length === 0) continue
      upserts.push({
        player_id: row.player_id,
        season,
        week,
        stat_type: 'weekly',
        source: 'sleeper',
        is_live: isLive,
        updated_at: new Date().toISOString(),
        ...mapped,
      })
    }
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
 * In-season live/box-score sync. During a game window it upserts the current
 * week's running numbers flagged is_live. Once the window closes (or for any
 * older week still flagged live) it runs one FINAL pass: re-fetches the
 * settled numbers and writes them with is_live=false, so finished games
 * never stay flagged in-progress. Outside the season it's a cheap no-op.
 */
export async function syncLiveStats(
  supabase: SyncClient,
  season: number,
  currentWeek: number,
  now: Date = new Date(),
): Promise<SyncSummary> {
  if (currentWeek < 1 || currentWeek > 18) {
    return { name: 'live-stats', counts: { skipped: 1 }, warnings: ['offseason — skipped'] }
  }

  const games = await fetchSchedule(season)
  const weekGames = games.filter((g) => g.week === currentWeek && g.date)
  const inWindow = weekGames.some((g) => {
    const kickoffDay = new Date(`${g.date}T00:00:00Z`).getTime()
    return now.getTime() >= kickoffDay && now.getTime() <= kickoffDay + WINDOW_MS
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
    counts[`finalized-wk${week}`] = await ingestWeek(supabase, season, week, false, known)
  }
  if (inWindow) {
    counts[`live-wk${currentWeek}`] = await ingestWeek(
      supabase,
      season,
      currentWeek,
      true,
      known,
    )
  }

  return { name: 'live-stats', counts, warnings: [] }
}
