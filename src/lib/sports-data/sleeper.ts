const SLEEPER_API_BASE = 'https://api.sleeper.app/v1'
const SLEEPER_HEADSHOT_BASE = 'https://sleepercdn.com/content/nfl/players/thumb'

export type SleeperPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export const FANTASY_POSITIONS: readonly SleeperPosition[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
] as const

export interface SleeperPlayer {
  player_id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  position: string | null
  fantasy_positions: string[] | null
  team: string | null
  number: number | null
  status: string | null
  injury_status: string | null
  active: boolean | null
  years_exp: number | null
  age: number | null
  birth_date: string | null
  height: string | null
  weight: string | null
  college: string | null
  search_full_name: string | null
  search_first_name: string | null
  search_last_name: string | null
  depth_chart_order: number | null
  depth_chart_position: string | null
}

export type SleeperPlayerMap = Record<string, SleeperPlayer>

export interface PlayerRow {
  id: string
  sleeper_id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  position: string
  team: string | null
  jersey_number: number | null
  headshot_url: string
  status: string
  experience_years: number
  height: string | null
  weight: number | null
  birth_date: string | null
  college: string | null
  depth_chart_order: number | null
  depth_chart_position: string | null
  search_name: string
  updated_at: string
}

export function getSleeperHeadshotUrl(sleeperId: string): string {
  return `${SLEEPER_HEADSHOT_BASE}/${sleeperId}.jpg`
}

export async function fetchAllPlayers(): Promise<SleeperPlayerMap> {
  const res = await fetch(`${SLEEPER_API_BASE}/players/nfl`, {
    headers: { accept: 'application/json' },
  })

  if (!res.ok) {
    throw new Error(`Sleeper API error: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as SleeperPlayerMap
}

export function isFantasyRelevant(player: SleeperPlayer): boolean {
  if (player.active !== true) return false
  // Sleeper keeps legendary retirees flagged active=true (Frank Gore, Adrian
  // Peterson, etc.). The reliable signal for "currently in the league" is
  // having a current NFL team — free agents and retirees show team = null.
  if (!player.team) return false
  const positions = player.fantasy_positions ?? (player.position ? [player.position] : [])
  return positions.some((p) => (FANTASY_POSITIONS as readonly string[]).includes(p))
}

function pickFantasyPosition(player: SleeperPlayer): string | null {
  const candidates = player.fantasy_positions ?? (player.position ? [player.position] : [])
  return (
    candidates.find((p) => (FANTASY_POSITIONS as readonly string[]).includes(p)) ?? null
  )
}

function parseWeight(weight: string | null): number | null {
  if (!weight) return null
  const n = parseInt(weight, 10)
  return Number.isFinite(n) ? n : null
}

/** The projected stat keys Sleeper's projections API exposes, superset
 *  across positions. All optional — QBs have no rec keys, kickers no pass. */
export interface SleeperProjectedStats {
  pass_yd?: number | null
  pass_td?: number | null
  pass_int?: number | null
  rush_yd?: number | null
  rush_td?: number | null
  rec?: number | null
  rec_yd?: number | null
  rec_td?: number | null
  fum_lost?: number | null
  pass_2pt?: number | null
  rush_2pt?: number | null
  rec_2pt?: number | null
  fgm_40_49?: number | null
  fgm_50p?: number | null
  xpm?: number | null
  sack?: number | null
  int?: number | null
  fum_rec?: number | null
  def_fum_td?: number | null
  pass_int_td?: number | null
  def_kr_td?: number | null
  pr_td?: number | null
  safe?: number | null
}

/** App-convention projected stat line (matches ScoringRules/StatRow keys in
 *  lib/scoring/default.ts) so calculateFantasyPoints can score it directly. */
export type ProjectedStatLine = Record<string, number>

const projNum = (v: number | null | undefined): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Map a Sleeper projected stat object into the app's StatRow convention.
 * Only writes keys with a non-zero value so the stored JSON stays small.
 * Kicker note: Sleeper projects only 40+ FG buckets (no short-FG key), so
 * fg_made stays absent — the per-bucket 40+/50+ fields carry the points,
 * which matches how Sleeper's own pts_std for kickers is built.
 */
export function sleeperProjectionToStatRow(
  stats: SleeperProjectedStats | null | undefined,
): ProjectedStatLine {
  if (!stats) return {}
  const line: ProjectedStatLine = {}
  const set = (key: string, value: number) => {
    if (value !== 0) line[key] = Math.round(value * 10) / 10
  }
  set('pass_yards', projNum(stats.pass_yd))
  set('pass_tds', projNum(stats.pass_td))
  set('interceptions', projNum(stats.pass_int))
  set('rush_yards', projNum(stats.rush_yd))
  set('rush_tds', projNum(stats.rush_td))
  set('receptions', projNum(stats.rec))
  set('receiving_yards', projNum(stats.rec_yd))
  set('receiving_tds', projNum(stats.rec_td))
  set('fumbles_lost', projNum(stats.fum_lost))
  set(
    'two_point_conversions',
    projNum(stats.pass_2pt) + projNum(stats.rush_2pt) + projNum(stats.rec_2pt),
  )
  set('fg_made_40_plus', projNum(stats.fgm_40_49))
  set('fg_made_50_plus', projNum(stats.fgm_50p))
  set('xp_made', projNum(stats.xpm))
  set('def_sacks', projNum(stats.sack))
  set('def_interceptions', projNum(stats.int))
  set('def_fumble_recoveries', projNum(stats.fum_rec))
  set(
    'def_tds',
    projNum(stats.def_fum_td) +
      projNum(stats.pass_int_td) +
      projNum(stats.def_kr_td) +
      projNum(stats.pr_td),
  )
  set('def_safeties', projNum(stats.safe))
  return line
}

export function mapSleeperPlayerToDb(player: SleeperPlayer): PlayerRow | null {
  const position = pickFantasyPosition(player)
  if (!position) return null

  const fullName = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(' ').trim()
  if (!fullName) return null

  const status = player.injury_status?.trim() || player.status?.trim() || 'Active'

  return {
    id: player.player_id,
    sleeper_id: player.player_id,
    full_name: fullName,
    first_name: player.first_name,
    last_name: player.last_name,
    position,
    team: player.team,
    jersey_number: player.number,
    headshot_url: getSleeperHeadshotUrl(player.player_id),
    status,
    experience_years: player.years_exp ?? 0,
    height: player.height,
    weight: parseWeight(player.weight),
    birth_date: player.birth_date,
    college: player.college,
    depth_chart_order: player.depth_chart_order,
    depth_chart_position: player.depth_chart_position,
    search_name: (player.search_full_name ?? fullName.toLowerCase().replace(/\s+/g, '')),
    updated_at: new Date().toISOString(),
  }
}
