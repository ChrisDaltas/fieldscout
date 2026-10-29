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

// ---------------------------------------------------------------------------
// FieldScout replaces a missing commissioner (F750; migration 208
// `op_set_commissioner`; spec §24.4 v2.16.106).
// ---------------------------------------------------------------------------

export const SET_COMMISSIONER_UNAVAILABLE = 'Replacing a commissioner is not available yet.'

/** Who can be made the commissioner: a person in the seat (not a vacant or
 *  placeholder seat) who is not already the commissioner, in a league that is
 *  not deleted. The RPC refuses the rest; the page never offers them. */
export function canBeMadeCommissioner(member: OpLeagueMember, league: Pick<OpLeagueRow, 'deleted_at'>): boolean {
  return league.deleted_at === null && !member.vacant && member.user_id !== null && member.role !== 'commissioner'
}

function memberName(m: OpLeagueMember): string {
  return m.username ?? m.team_name ?? 'This member'
}

/** The confirm dialog's Now / After for making `member` the commissioner. */
export function commissionerBeforeAfter(
  member: OpLeagueMember,
  members: readonly OpLeagueMember[],
): { before: string; after: string } {
  const sitting = members.find((m) => m.role === 'commissioner' && m.member_id !== member.member_id)
  const name = memberName(member)
  const now = `${name} is a ${roleWords(member.role).toLowerCase()}.`
  if (!sitting) {
    return {
      before: `This league has no commissioner. ${now}`,
      after: `${name} is the commissioner. The league sees “FieldScout made ${name} the commissioner.”`,
    }
  }
  const old = memberName(sitting)
  return {
    before: `${old} is the commissioner. ${now}`,
    after: `${name} is the commissioner. ${old} is a co-commissioner and keeps their team. The league sees “FieldScout made ${name} the commissioner. ${old} is now a co-commissioner.”`,
  }
}

export function setCommissionerUrl(leagueId: string): string {
  return `/api/admin/leagues/${encodeURIComponent(leagueId)}/commissioner`
}

// FieldScout restores an archived league (F851; migration 212 `op_restore_league`).
export const RESTORE_LEAGUE_UNAVAILABLE = 'Restoring a league is not available yet.'

export function restoreLeagueUrl(leagueId: string): string {
  return `/api/admin/leagues/${encodeURIComponent(leagueId)}/restore`
}

/** The confirm dialog for restoring an archived league (F851). */
export function restoreLeagueConfirm(league: Pick<OpLeagueRow, 'id' | 'name'>): {
  title: string
  before: string
  after: string
  confirmLabel: string
  url: string
  body: Record<string, unknown>
} {
  return {
    title: `Restore ${league.name}`,
    before: 'The league is archived: hidden from its members, and nothing in it changes.',
    after:
      'The league is back for every member, exactly as it was. The league sees “FieldScout restored the league.” If its commissioner is gone, make a member the commissioner next.',
    confirmLabel: 'Restore league',
    url: restoreLeagueUrl(league.id),
    body: {},
  }
}
