/**
 * Pure helpers for the phone's Leagues screen (`/app/leagues`, gap list §4
 * item 104). No time, DOM or fetch here.
 */

/** Where Leagues' Back goes when nothing in the app is behind it: Home,
 *  whose Matchups cards are the same leagues. */
export const LEAGUES_PARENT = '/app'

/** Copy shared by the screen and its tests. */
export const LEAGUES_COPY = {
  emptyTitle: 'No leagues yet',
  // Desktop's empty-state words: both doors are free (business rule 5).
  emptyBody: 'Create your own league and invite your friends, or join one with an invite code. Both are free.',
  loadFailed: 'Your leagues could not be loaded.',
  offline: 'Your leagues have not loaded because the browser reports no network connection.',
  refreshFailed: 'Your leagues could not be refreshed.',
} as const

/**
 * The pill a league past its draft carries on the Leagues screen — desktop's
 * status badge for the two states Home's card has no words for:
 *  - playoffs: "Playoffs" (the blue tint);
 *  - complete: "Complete" (quiet).
 * In season says nothing (the week's matchup speaks), and before or during
 * the draft the card's own draft pill speaks ("Pre-draft", "Draft Aug 28 ·
 * 7:00 PM", "Draft live").
 */
export interface LeagueStatusPill {
  label: string
  tone: 'blue' | 'quiet'
}

export function leagueStatusPill(status: string): LeagueStatusPill | null {
  if (status === 'playoffs') return { label: 'Playoffs', tone: 'blue' }
  if (status === 'complete') return { label: 'Complete', tone: 'quiet' }
  return null
}

/**
 * The role a league card names on the Leagues screen — desktop's card says
 * it on every league. Only the commissioners are named: every member
 * manages a team, so "Manager" would say nothing a row doesn't already.
 */
export function commishRole(role: string): string | null {
  if (role === 'commissioner') return 'Commissioner'
  if (role === 'co_commissioner') return 'Co-commissioner'
  return null
}

/** The card's sub on the Leagues screen: Home's ("8-team PPR · Week 5"),
 *  then the role when you run the league ("… · Commissioner"). */
export function leaguesCardSub(sub: string, role: string): string {
  const named = commishRole(role)
  return named ? `${sub} · ${named}` : sub
}
