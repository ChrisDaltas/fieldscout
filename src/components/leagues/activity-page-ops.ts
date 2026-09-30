/**
 * The Activity page — pure half (M6 task L.E1.34; spec §16.1
 * `…/leagues/[id]/activity` "Activity + Commissioner Action Log", §13.4,
 * §10.3; PROGRESS D459).
 *
 * One spelling of every URL into the page (the tabs, the commissioner log's
 * team / week / entry, the stat corrections' week), the tab list and its
 * copy, and the parse of the URL back into state — so a door elsewhere (a ✸
 * badge on a matchup, a roster, a feed line; League Home's "See all
 * activity"; the console's "See all"; the matchup's correction note) can
 * never drift from what the page reads.
 */
import { weekFromParam } from './matchup-view-ops'

export const ACTIVITY_TABS = ['all', 'adds', 'trades', 'commissioner', 'corrections'] as const
export type ActivityTab = (typeof ACTIVITY_TABS)[number]

export const ACTIVITY_TAB_LABELS: Readonly<Record<ActivityTab, string>> = {
  all: 'All',
  adds: 'Adds & drops',
  trades: 'Trades',
  commissioner: 'Commissioner',
  corrections: 'Stat corrections',
}

export const ACTIVITY_PAGE_TITLE = 'League activity'
export const SEE_ALL_ACTIVITY_LABEL = 'See all activity'
export const SEE_ALL_COMMISH_LABEL = 'See all commissioner actions'
export const SHOW_OLDER_LABEL = 'Show older'
export const SHOW_NEWEST_LABEL = 'Back to the newest'

/** What each feed tab holds, said once above its list. */
export const TAB_INTRO_COPY: Readonly<Record<Exclude<ActivityTab, 'corrections'>, string>> = {
  all: 'Everything that happened in the league, newest first. Lines marked ✸ are the commissioner’s — tap ✸ to see the entry in his log.',
  adds: 'Players added and dropped by the teams, and waiver claims that went through. The commissioner’s roster changes are on the Commissioner tab.',
  trades: 'Trades that went through, were vetoed or were reversed. Offers stay between the two teams, in their trade center.',
  commissioner: 'Every change a commissioner made, for the whole league to see.',
}

/** A feed tab with nothing in it (the log's own empty copy lives with it). */
export const TAB_EMPTY_COPY: Readonly<Record<'all' | 'adds' | 'trades', string>> = {
  all: 'Nothing has happened in this league yet.',
  adds: 'No adds or drops yet.',
  trades: 'No trades have gone through, been vetoed or been reversed yet.',
}

/** The commissioner log filtered to nothing (the unfiltered empty copy is the log's own). */
export const COMMISH_FILTERED_EMPTY_COPY = 'No commissioner actions match these filters.'
/** F534: what the log's week filter shows — the narrow meaning, in words. */
export const COMMISH_WEEK_NOTE =
  'A week shows the commissioner’s fixes to that week’s lineups, scores, results and matchups. Trades, roster moves, settings and member changes aren’t tied to a week — choose “All weeks” to see them.'
/** The log opened AT an entry (a ✸ door). */
export const COMMISH_ENTRY_NOTE = 'Showing the action you opened, then everything older.'

export const ALL_TEAMS_LABEL = 'All teams'
export const ALL_WEEKS_LABEL = 'All weeks'

/** The feed's `transactions.type`s on the Adds & drops tab (§12.9 — the
 *  managers' own moves and won claims; the commissioner's are his tab's). */
export const ADD_DROP_TYPES = ['add', 'drop', 'add_drop', 'waiver_claim'] as const

export interface ActivityRoute {
  tab: ActivityTab
  /** The Commissioner tab's week filter, or the Stat corrections tab's week. */
  week: number | null
  /** The Commissioner tab's team filter. */
  team: string | null
  /** The Commissioner tab opened AT this log entry. */
  entry: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One URL into the page. Only what is set reaches the query string; a
 *  week / team / entry is only written for the tab that reads it. */
export function activityHref(leagueId: string, route: Partial<ActivityRoute> = {}): string {
  const tab = route.tab ?? 'all'
  const params = new URLSearchParams()
  if (tab !== 'all') params.set('tab', tab)
  if ((tab === 'commissioner' || tab === 'corrections') && route.week != null) params.set('week', String(route.week))
  if (tab === 'commissioner' && route.team) params.set('team', route.team)
  if (tab === 'commissioner' && route.entry) params.set('entry', route.entry)
  const query = params.toString()
  return `/app/leagues/${leagueId}/activity${query ? `?${query}` : ''}`
}

/** A ✸ line's door — the log opened at its entry (F233(d)). */
export function commishEntryHref(leagueId: string, actionId: string): string {
  return activityHref(leagueId, { tab: 'commissioner', entry: actionId })
}

/** A ✸ badge on a matchup — the log filtered to that week and one of its teams
 *  (a score, result or pairing receipt records both, D455(4)). */
export function commishMatchupHref(leagueId: string, week: number | null, teamId: string | null): string {
  return activityHref(leagueId, { tab: 'commissioner', week, team: teamId })
}

/** A ✸ badge on a roster / a team — every commissioner action that names the
 *  team (no week: a roster move records none — F534). */
export function commishTeamHref(leagueId: string, teamId: string): string {
  return activityHref(leagueId, { tab: 'commissioner', team: teamId })
}

/** The URL's query → the page's state. Anything malformed is dropped (the
 *  page opens on All), never an error page for a hand-edited link. */
export function parseActivityRoute(query: Record<string, string | string[] | undefined>): ActivityRoute {
  const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
  const rawTab = one(query.tab)
  const tab: ActivityTab = (ACTIVITY_TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as ActivityTab) : 'all'
  const uuid = (v: string | undefined): string | null => (v && UUID_RE.test(v) ? v.toLowerCase() : null)
  return {
    tab,
    week: tab === 'commissioner' || tab === 'corrections' ? weekFromParam(query.week) : null,
    team: tab === 'commissioner' ? uuid(one(query.team)) : null,
    entry: tab === 'commissioner' ? uuid(one(query.entry)) : null,
  }
}

/**
 * R1392: the page's state is the URL's. `useSearchParams()` → the route on
 * every render; `fallback` (the server's parse of the same URL) only when there
 * is nothing to read. Pure; the page's one reader.
 */
export function activityRouteFrom(searchParams: { entries(): IterableIterator<[string, string]> } | null, fallback: ActivityRoute): ActivityRoute {
  if (!searchParams) return fallback
  return parseActivityRoute(Object.fromEntries(searchParams.entries()))
}
