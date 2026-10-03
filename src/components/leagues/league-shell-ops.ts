/**
 * The league workspace's header — pure decisions for `league-shell.tsx`
 * (League UX batch 1, Chris 2026-10-03; the Claude Design prototype's
 * `LeagueIdentity` / `LeagueSubnav` / `TABS` / `MORE`).
 *
 * One header for every league page in every league state: the tabs that
 * have no meaning yet are shown DISABLED with the reason (prevent, don't
 * refuse), and the commissioner's console is reached from League settings
 * only — it is not a tab and not a More item.
 */

import { activityHref } from './activity-page-ops'
import { membersPageHref } from './invite-panel-ops'
import { teamPageHref } from './league-cells'
import { tradesHref } from './trades-ops'

export type LeagueTabKey = 'home' | 'team' | 'matchup' | 'players' | 'schedule' | 'stats'
export type LeagueMoreKey = 'settings' | 'draft' | 'trades' | 'members' | 'activity'

export interface LeagueTab {
  key: LeagueTabKey
  label: string
  /** null = disabled; `disabledReason` says why. */
  href: string | null
  disabledReason: string | null
}

export interface LeagueMoreItem {
  key: LeagueMoreKey
  label: string
  href: string
  /** The live draft room opens with the platform split (`useRoomEntryTarget`). */
  room?: boolean
}

/** The season has a schedule, matchups and standings once the draft is done. */
export function seasonStarted(status: string): boolean {
  return status === 'in_season' || status === 'playoffs' || status === 'complete'
}

export const NOT_STARTED_REASON = 'Opens after the draft, when the season starts.'
export const NO_TEAM_REASON = 'You don’t manage a team in this league.'

export function leagueBase(leagueId: string): string {
  return `/app/leagues/${leagueId}`
}

/**
 * The six tabs (prototype `TABS`). Stats is the head-to-head page
 * (League UX batch 5); Standings, linked from it and from League Home,
 * belongs to the same tab.
 */
export function leagueTabs(leagueId: string, status: string, myTeamId: string | null): LeagueTab[] {
  const base = leagueBase(leagueId)
  const started = seasonStarted(status)
  const seasonTab = (key: LeagueTabKey, label: string, href: string): LeagueTab =>
    started ? { key, label, href, disabledReason: null } : { key, label, href: null, disabledReason: NOT_STARTED_REASON }
  return [
    { key: 'home', label: 'Home', href: base, disabledReason: null },
    myTeamId
      ? { key: 'team', label: 'My Team', href: teamPageHref(leagueId, myTeamId), disabledReason: null }
      : { key: 'team', label: 'My Team', href: null, disabledReason: NO_TEAM_REASON },
    seasonTab('matchup', 'Matchup', `${base}/matchup`),
    { key: 'players', label: 'Players', href: `${base}/players`, disabledReason: null },
    seasonTab('schedule', 'Schedule', `${base}/schedule`),
    seasonTab('stats', 'Stats', `${base}/stats`),
  ]
}

/**
 * The More menu (prototype `MORE`): League settings, the draft room, and the
 * pages visited a handful of times a season. Trades only exist once there
 * are rosters; before the draft finishes the draft entry is the live room,
 * after it the recap.
 */
export function leagueMoreItems(leagueId: string, status: string): LeagueMoreItem[] {
  const base = leagueBase(leagueId)
  const started = seasonStarted(status)
  const items: LeagueMoreItem[] = [{ key: 'settings', label: 'League settings', href: `${base}/settings` }]
  items.push(
    started
      ? { key: 'draft', label: 'Draft recap', href: `${base}/draft/recap` }
      : { key: 'draft', label: 'Draft room', href: `${base}/draft`, room: true },
  )
  if (started) items.push({ key: 'trades', label: 'Trades', href: tradesHref(leagueId) })
  items.push({ key: 'members', label: 'Members', href: membersPageHref(leagueId) })
  items.push({ key: 'activity', label: 'Activity', href: activityHref(leagueId) })
  return items
}

/** Which tab / More item the current path belongs to (null = none). The
 *  Commissioner console counts as League settings — that is its only door. */
export function activeLeagueSection(
  pathname: string,
  leagueId: string,
  myTeamId: string | null,
): LeagueTabKey | LeagueMoreKey | null {
  const base = leagueBase(leagueId)
  if (pathname === base || pathname === `${base}/`) return 'home'
  if (!pathname.startsWith(`${base}/`)) return null
  const [first, second] = pathname.slice(base.length + 1).split('/')
  switch (first) {
    case 'team':
      return myTeamId && second === myTeamId ? 'team' : null
    case 'matchup':
      return 'matchup'
    case 'players':
      return 'players'
    case 'schedule':
      return 'schedule'
    case 'stats':
    case 'standings':
      return 'stats'
    case 'settings':
    case 'commish':
      return 'settings'
    case 'draft':
      return 'draft'
    case 'trades':
      return 'trades'
    case 'members':
      return 'members'
    case 'activity':
    case 'corrections':
      return 'activity'
    default:
      return null
  }
}

/** "12 teams · 15 roster spots · PPR" — the identity row's muted line.
 *  Parts we cannot read are left out, never guessed. */
export function identityLine(teamCount: number, rosterSpots: number | null, scoring: string | null): string {
  const parts = [`${teamCount} team${teamCount === 1 ? '' : 's'}`]
  if (rosterSpots !== null) parts.push(`${rosterSpots} roster spot${rosterSpots === 1 ? '' : 's'}`)
  if (scoring) parts.push(scoring)
  return parts.join(' · ')
}

export const SCORING_FAMILY_LABEL: Record<'ppr' | 'half_ppr' | 'standard', string> = {
  ppr: 'PPR',
  half_ppr: 'Half PPR',
  standard: 'Standard',
}

export const OVERRIDE_ON_INDICATOR = 'Commissioner override on'

/** The league's status as a badge — shown in the identity row until there
 *  is a record to show instead. */
export const LEAGUE_STATUS_BADGE: Record<string, { label: string; variant: 'yellow' | 'lime' | 'stroke' | 'green' }> = {
  setup: { label: 'Setup', variant: 'yellow' },
  scheduled: { label: 'Draft scheduled', variant: 'lime' },
  drafting: { label: 'Draft live', variant: 'lime' },
  in_season: { label: 'In season', variant: 'green' },
  playoffs: { label: 'Playoffs', variant: 'green' },
  complete: { label: 'Complete', variant: 'stroke' },
}
