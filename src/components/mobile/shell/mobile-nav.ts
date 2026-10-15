/**
 * FieldScout Mobile navigation model (handoff navigation graph §(c), §(e)).
 *
 * Two tab bars that REPLACE each other: outside a league — Home, Community,
 * Players, Profile; inside a league — Match, Team, Players, League, Menu.
 * The league switcher card sits above the league bar on the four league tabs
 * only. Routes keep the app's existing URLs.
 */

export type LeagueTab = 'match' | 'team' | 'players' | 'league'
export type AccountTab = 'home' | 'community' | 'players' | 'profile'

export interface MobileRoute {
  /** The league this route belongs to, or null outside a league. */
  leagueId: string | null
  /** The highlighted league tab, when the route IS one of the four tabs. */
  leagueTab: LeagueTab | null
  /** The highlighted account tab, when the route is one of the four roots. */
  accountTab: AccountTab | null
}

const LEAGUE = /^\/app\/leagues\/([^/]+)(\/.*)?$/

/** Which tab bar and which highlighted item a pathname maps to. */
export function mobileRoute(pathname: string, myTeamId: string | null): MobileRoute {
  const m = LEAGUE.exec(pathname)
  if (m && m[1]) {
    const leagueId = m[1]
    const rest = m[2] ?? ''
    let leagueTab: LeagueTab | null = null
    if (rest === '' || rest === '/' || rest === '/standings' || rest === '/activity') leagueTab = 'league'
    else if (rest === '/matchup' || rest.startsWith('/matchup/')) leagueTab = 'match'
    else if (rest === '/players') leagueTab = 'players'
    else if (rest.startsWith('/team/')) {
      const teamId = rest.slice('/team/'.length).split('/')[0]
      // Your own team is the Team tab; another team's page is a team view
      // (league bar, nothing lit — handoff "Team view" overlay).
      leagueTab = teamId === 'mine' || (myTeamId !== null && teamId === myTeamId) ? 'team' : null
    }
    return { leagueId, leagueTab, accountTab: null }
  }
  let accountTab: AccountTab | null = null
  if (pathname === '/app') accountTab = 'home'
  else if (pathname.startsWith('/app/explore')) accountTab = 'community'
  else if (pathname.startsWith('/app/research') || pathname.startsWith('/app/players')) accountTab = 'players'
  // Lists and Rankings open from Profile; the design lights Profile there.
  else if (
    ['/app/profile', '/app/stats', '/app/lists', '/app/weekly-ranks', '/app/big-board'].some(
      (root) => pathname === root || pathname.startsWith(`${root}/`) || pathname.startsWith(`${root}?`),
    )
  )
    accountTab = 'profile'
  return { leagueId: null, leagueTab: null, accountTab }
}

/**
 * League pages with no FieldScout Mobile screen of their own yet, by the
 * title their Menu row uses. The league shell gives these a plain mobile
 * header (close + title) in place of the desktop league header. Null = the
 * route draws its own mobile screen (the four tabs, Activity and its
 * sub-screens, trades, team views, matchups).
 */
const LEAGUE_FALLBACK_TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/settings(\/|$)/, 'League settings'],
  [/^\/schedule(\/|$)/, 'Schedule'],
  [/^\/draft\/recap(\/|$)/, 'Draft results'],
  [/^\/members(\/|$)/, 'Members'],
  [/^\/commish(\/|$)/, 'Commissioner tools'],
  [/^\/stats(\/|$)/, 'League stats'],
]

export function leagueFallbackTitle(pathname: string): string | null {
  const rest = LEAGUE.exec(pathname)?.[2] ?? ''
  for (const [re, title] of LEAGUE_FALLBACK_TITLES) if (re.test(rest)) return title
  return null
}

export function leagueTabHref(leagueId: string, tab: LeagueTab, myTeamId: string | null): string {
  switch (tab) {
    case 'match':
      return `/app/leagues/${leagueId}/matchup`
    case 'team':
      return `/app/leagues/${leagueId}/team/${myTeamId ?? 'mine'}`
    case 'players':
      return `/app/leagues/${leagueId}/players`
    case 'league':
      return `/app/leagues/${leagueId}`
  }
}

/** Dock heights (handoff §2.1): small = tab bar only; large = switcher strip
 *  (68px) + tab bar. Scrollers clear the dock by these. */
export const DOCK_SM = 84
export const DOCK_LG = 150
