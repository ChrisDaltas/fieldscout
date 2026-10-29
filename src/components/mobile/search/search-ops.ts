/**
 * FieldScout Mobile — full-screen search, the pure half (gap list §3 #1;
 * handoff m-match §2.4 / §3.6, `gsVals`).
 *
 * - Scopes: All / Players / People / Posts. All shows the first 5 players,
 *   4 people and 4 posts; a single scope shows up to 30 of its own.
 * - Empty query: Recent (kept on this phone only) and Trending (the Home
 *   Risers — the app's one trend signal, projection vs last season).
 * - Inside a league, People also finds the league's managers (a manager
 *   opens their team) and each player says where he is in that league:
 *   Your team, another team's name, Waivers or Free agent — and Pre-draft
 *   while the league hasn't drafted him yet (ruling #44's wording).
 * - Posts are public lists for now (Community's start-or-sit and rankings
 *   aren't searchable yet).
 */
import { preDraftFor } from '@/components/mobile/player/profile-ops'
import type { Availability } from '@/components/leagues/players-page-ops'

export type SearchScope = 'all' | 'players' | 'people' | 'posts'
export type SearchSection = Exclude<SearchScope, 'all'>

export const SEARCH_SCOPES: ReadonlyArray<{ value: SearchScope; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'players', label: 'Players' },
  { value: 'people', label: 'People' },
  { value: 'posts', label: 'Posts' },
]

/** How many rows a section shows: a few under All, a page on its own. */
const ALL_CAP: Record<SearchSection, number> = { players: 5, people: 4, posts: 4 }
export const SCOPE_CAP = 30

export function sectionCap(section: SearchSection, scope: SearchScope): number {
  return scope === section ? SCOPE_CAP : ALL_CAP[section]
}

export function showsSection(scope: SearchScope, section: SearchSection): boolean {
  return scope === 'all' || scope === section
}

export type SectionState = 'ready' | 'pending' | 'error'

export interface SectionStatus {
  state: SectionState
  /** Rows the section would show. */
  count: number
}

/** A read as the section sees it (a React Query result fits). */
export interface SearchRead {
  isError: boolean
  /** The rows are an earlier query's, kept on screen while this one reads. */
  isPlaceholderData: boolean
  data: unknown
}

/**
 * A section's state for the query on screen: pending until THIS query has
 * answered — while the typing is a beat ahead of the reads (`current`
 * false) and while the rows drawn are an earlier query's (kept so the list
 * doesn't blink). An earlier query's empty answer is never this one's
 * "No results".
 */
export function readState(current: boolean, read: SearchRead): SectionState {
  if (!current || read.isPlaceholderData) return 'pending'
  if (read.isError) return 'error'
  return read.data !== undefined ? 'ready' : 'pending'
}

/**
 * What the body says when a query is typed:
 *  - `results` — at least one visible section has rows;
 *  - `searching` — nothing to show yet and a visible section is still
 *    reading (never "No results" before every answer is in);
 *  - `failed` — nothing to show and a visible section's read failed (a
 *    failure is never dressed up as "No results");
 *  - `none` — every visible section answered, with nothing.
 */
export function bodyState(scope: SearchScope, sections: Record<SearchSection, SectionStatus>): 'results' | 'searching' | 'failed' | 'none' {
  const visible = (Object.keys(sections) as SearchSection[]).filter((s) => showsSection(scope, s)).map((s) => sections[s])
  if (visible.some((s) => s.count > 0)) return 'results'
  if (visible.some((s) => s.state === 'pending')) return 'searching'
  if (visible.some((s) => s.state === 'error')) return 'failed'
  return 'none'
}

// ---------------------------------------------------------------------------
// Recent searches — on this phone only
// ---------------------------------------------------------------------------

export const RECENT_SEARCHES_KEY = 'fs.mobile-search.recent'
export const RECENT_MAX = 6

/** The list with `label` added newest first: trimmed, once (case-blind),
 *  at most `RECENT_MAX`. A blank label changes nothing. */
export function withRecent(list: readonly string[], label: string): string[] {
  const l = label.trim()
  if (!l) return [...list]
  return [l, ...list.filter((x) => x.toLowerCase() !== l.toLowerCase())].slice(0, RECENT_MAX)
}

/** Storage can be blocked or cleared (a private window, site data off):
 *  then nothing is remembered, and nothing throws. */
export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function writeRecentSearches(list: readonly string[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(RECENT_SEARCHES_KEY)
    else window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list))
  } catch {
    // Storage blocked: nothing is remembered, and that's fine.
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The query as matched: trimmed, lower-cased. */
export function matchTerm(raw: string): string {
  return raw.trim().toLowerCase()
}

export interface SearchManager {
  userId: string
  username: string
  avatarUrl: string | null
  teamId: string
  teamName: string
}

export interface LeagueForSearch {
  members: ReadonlyArray<{ user_id: string | null; team_id: string | null; profiles: { username: string; avatar_url: string | null } | null }>
  teams: ReadonlyArray<{ id: string; name: string }>
}

/** The league's managers, you left out, in the league's team order (each
 *  manager of a co-managed team is listed). An empty seat has no one to find. */
export function leagueManagers(detail: LeagueForSearch, myUserId: string | null): SearchManager[] {
  const out: SearchManager[] = []
  for (const team of detail.teams) {
    for (const m of detail.members) {
      if (m.team_id !== team.id || !m.user_id || !m.profiles?.username || m.user_id === myUserId) continue
      out.push({ userId: m.user_id, username: m.profiles.username, avatarUrl: m.profiles.avatar_url, teamId: team.id, teamName: team.name })
    }
  }
  return out
}

/** "Gridiron Gurus · your league". */
export function managerSub(teamName: string): string {
  return `${teamName} · your league`
}

/** A manager matches on the handle (with its "@") or the line under it —
 *  so a team's name finds its manager. */
export function matchManagers(managers: readonly SearchManager[], raw: string): SearchManager[] {
  const q = matchTerm(raw)
  if (!q) return []
  return managers.filter((m) => `@${m.username} ${managerSub(m.teamName)}`.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// A player's place in the league
// ---------------------------------------------------------------------------

export type OwnerTone = 'mine' | 'other' | 'open' | 'pre'

export interface OwnerLabel {
  text: string
  tone: OwnerTone
}

/** Where he is in this league: Your team (blue), another team's name
 *  (grey), Waivers / Free agent (green); Pre-draft before the league has
 *  drafted him (ruling #44 — never "Free agent" in a league with no rosters). */
export function ownerLabel(a: Availability, leagueStatus: string): OwnerLabel {
  if (preDraftFor(leagueStatus, a.kind === 'rostered')) return { text: 'Pre-draft', tone: 'pre' }
  if (a.kind === 'rostered') return a.mine ? { text: 'Your team', tone: 'mine' } : { text: a.teamName, tone: 'other' }
  if (a.kind === 'on_waivers') return { text: 'Waivers', tone: 'open' }
  return { text: 'Free agent', tone: 'open' }
}
