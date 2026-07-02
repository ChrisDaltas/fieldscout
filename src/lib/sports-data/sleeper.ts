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
    search_name: (player.search_full_name ?? fullName.toLowerCase().replace(/\s+/g, '')),
    updated_at: new Date().toISOString(),
  }
}
