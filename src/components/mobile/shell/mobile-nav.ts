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
  // Community and its pages (the Latest page, `/app/explore/latest`).
  else if (pathname === '/app/explore' || pathname.startsWith('/app/explore/')) accountTab = 'community'
  else if (pathname.startsWith('/app/research') || pathname.startsWith('/app/players')) accountTab = 'players'
  // Lists and Rankings open from Profile; the design lights Profile there.
  else if (
    ['/app/profile', '/app/stats', '/app/lists', '/app/weekly-ranks', '/app/big-board'].some(
      (root) => pathname === root || pathname.startsWith(`${root}/`) || pathname.startsWith(`${root}?`),
    ) ||
    // My start/sit opens from Profile (#26); its question pages don't.
    pathname === '/app/start-or-sit'
  )
    accountTab = 'profile'
  return { leagueId: null, leagueTab: null, accountTab }
}

/**
 * Pages with no FieldScout Mobile screen of their own yet, by title. The
 * shell gives these a plain mobile header — close (league pages, reached
 * from the league Menu) or back (account pages) and the title — over the
 * page's existing layout. Null = the route draws its own mobile screen.
 */
const LEAGUE_FALLBACK_TITLES: ReadonlyArray<[RegExp, string]> = [
  // Every league page draws its own phone screen now — the last were League
  // settings / Scoring / Playoffs (`/settings` — gap list §4 item 105),
  // Members (`/members` — item 106), Schedule (`/schedule` — item 107) and
  // Commissioner tools (`/commish` — item 109). A league page added without
  // one goes here, titled, until it gets its own.
]

/** `false` third entry: the page already owns its h1 (the shell's title
 *  renders as plain text there). */
const ACCOUNT_FALLBACK_TITLES: ReadonlyArray<[RegExp, string, boolean?]> = [
  [/^\/app\/start-or-sit\/new\/?$/, 'Ask a question'],
  [/^\/app\/start-or-sit\/[^/]+\/?$/, 'Start or sit'],
  [/^\/app\/teams\/[^/]+(\/live)?\/?$/, 'Team'],
  [/^\/app\/admin\/posts\/?$/, 'Posts'],
]

export type MobileFallback =
  | { kind: 'league'; title: string; leagueId: string; heading: true }
  | { kind: 'account'; title: string; parent: string; heading: boolean }

export function mobileFallback(pathname: string): MobileFallback | null {
  const league = LEAGUE.exec(pathname)
  if (league && league[1]) {
    const rest = league[2] ?? ''
    for (const [re, title] of LEAGUE_FALLBACK_TITLES) if (re.test(rest)) return { kind: 'league', title, leagueId: league[1], heading: true }
    return null
  }
  for (const [re, title, heading] of ACCOUNT_FALLBACK_TITLES) {
    if (re.test(pathname)) return { kind: 'account', title, parent: ACCOUNT_FALLBACK_PARENT, heading: heading !== false }
  }
  return null
}

/** Where an account page's Back goes when nothing in the app is behind it.
 *  (Settings and its pages — gap list §4 item 101 — Trash, item 102, the
 *  NFL team pages, item 103, Leagues, item 104, Mock drafts and their
 *  reports, item 110, and Ranking history, item 111, draw their own phone
 *  screens now, each with its own parent, so every page left here goes
 *  Home.) */
const ACCOUNT_FALLBACK_PARENT = '/app'

/** The title alone (league pages), for callers that only need to know the
 *  shell titles the page. */
export function leagueFallbackTitle(pathname: string): string | null {
  const f = mobileFallback(pathname)
  return f?.kind === 'league' ? f.title : null
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

/**
 * The league a swipe on the switcher lands on (handoff §2.2: left = next,
 * right = previous, wrapping round your leagues). It goes on from the league
 * a switch still on its way is heading to, else from the one on screen — so
 * two quick swipes move two leagues instead of the same one twice (gap list
 * §4 item 8). Null with no other league to move to.
 */
export function swipeLeague<T extends { id: string }>(
  leagues: readonly T[],
  onScreenId: string,
  headingToId: string | null,
  d: 1 | -1,
): T | null {
  const n = leagues.length
  if (n < 2) return null
  const heading = headingToId === null ? -1 : leagues.findIndex((l) => l.id === headingToId)
  const from = heading >= 0 ? heading : Math.max(0, leagues.findIndex((l) => l.id === onScreenId))
  return leagues[(from + d + n) % n] ?? null
}

/** Dock heights (handoff §2.1): small = tab bar only; large = switcher strip
 *  (68px) + tab bar. Scrollers clear the dock by these. */
export const DOCK_SM = 84
export const DOCK_LG = 150

/**
 * Does the league switcher strip show above the tab bar? On a league tab
 * (not a league sub-screen), and only when there is another league to
 * switch to — with one league it is just a card for the league you're
 * already in (Chris, 2026-10-17: "only display if the user has multiple
 * leagues"). While the leagues are still loading the count is 0: no strip
 * yet, rather than one that might vanish.
 */
export function showsLeagueSwitcher(inLeague: boolean, leagueTab: LeagueTab | null, leagueCount: number): boolean {
  return inLeague && leagueTab !== null && leagueCount > 1
}
