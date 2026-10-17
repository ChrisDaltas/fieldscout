/**
 * The admin all-leagues table (M8 follow-up, Chris 2026-10-15; migration 193
 * `op_list_leagues` / `op_league_detail`; F599) — the payload shapes, the
 * named pre-push 503 words, and the query-string builder shared by the route,
 * the hook and the page.
 */

export const LEAGUE_TABLE_UNAVAILABLE = 'The all-leagues table is not available yet (migration 193 is not pushed).'
export const LEAGUE_DETAIL_UNAVAILABLE =
  'League members and settings are not available yet (migration 193 is not pushed).'

export const LEAGUE_SORTS = ['name', 'created', 'season', 'status', 'members', 'commissioner'] as const
export type LeagueSort = (typeof LEAGUE_SORTS)[number]
export const LEAGUE_PAGE_SIZE = 50

export interface OpLeagueSettingsSummary {
  scoring: string
  roster_size: number
  roster: string
  waivers: string
  trade_review: string
  trade_deadline: string
  playoffs: string
  season_length: string
  schedule: string
}

export interface OpLeagueRow {
  id: string
  name: string
  status: string
  phase: string
  season: number
  created_at: string | null
  deleted_at: string | null
  commissioner_id: string | null
  commissioner: string | null
  team_count: number
  members: number
  teams: number
  vacant_seats: number
  open_seats: number
  draft: { id: string; type: string; status: string; summary: string } | null
  current_week: { week: number; status: string; summary: string } | null
  settings_summary: OpLeagueSettingsSummary
}

export interface OpLeagueList {
  as_of: string
  q: string
  sort: LeagueSort
  desc: boolean
  include_deleted: boolean
  total: number
  limit: number
  offset: number
  more: boolean
  leagues: OpLeagueRow[]
}

export interface OpLeagueMember {
  member_id: string
  team_id: string | null
  team_name: string | null
  team_status: string | null
  user_id: string | null
  username: string | null
  role: 'commissioner' | 'co_commissioner' | 'manager' | string
  joined_at: string | null
  vacant: boolean
  autopilot: boolean
  record: { wins: number; losses: number; ties: number; rank: number; points_for: number | string } | null
}

export interface OpLeagueDetail {
  as_of: string
  league: OpLeagueRow
  settings: Record<string, unknown> & {
    roster_settings: unknown
    settings: Record<string, unknown>
  }
  record_error: string | null
  members: OpLeagueMember[]
}

export interface LeagueTableQuery {
  q: string
  sort: LeagueSort
  dir: 'asc' | 'desc'
  offset: number
  limit?: number
  deleted: boolean
}

export function leagueTableUrl(query: LeagueTableQuery): string {
  const sp = new URLSearchParams()
  if (query.q) sp.set('q', query.q)
  sp.set('sort', query.sort)
  sp.set('dir', query.dir)
  sp.set('offset', String(query.offset))
  sp.set('limit', String(query.limit ?? LEAGUE_PAGE_SIZE))
  if (query.deleted) sp.set('deleted', '1')
  return `/api/admin/leagues?${sp.toString()}`
}

/** "Showing 51–100 of 240" — the page always states the true total. */
export function pageWords(list: Pick<OpLeagueList, 'offset' | 'total' | 'leagues'>): string {
  if (list.total === 0) return 'No leagues'
  const from = list.offset + 1
  const to = list.offset + list.leagues.length
  return `Showing ${from}–${to} of ${list.total}`
}

/** "3-1-0", or "—" when the standings have no row for the seat. */
export function recordWords(r: OpLeagueMember['record']): string {
  if (!r) return '—'
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`
}

export function roleWords(role: string): string {
  if (role === 'commissioner') return 'Commissioner'
  if (role === 'co_commissioner') return 'Co-commissioner'
  return 'Manager'
}
