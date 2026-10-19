import { DASH, isDefense, statusPill } from '@/components/mobile/player/profile-ops'
import type { RosterPlayer } from '@/components/teams/team-roster'

/**
 * NFL team pages on the phone (gap list §4 item 103) — pure labels over the
 * same rows the desktop pages draw: the static team table (`nfl-teams.ts`)
 * and the team's `players` rows the route reads, ADP-sorted. Nothing here is
 * invented: a value the row doesn't have is left out (or a dash in the ADP
 * column).
 */

/** Where Back goes when nothing in the app is behind: the teams list for a
 *  team, Home for the list itself (the account pages' parent). */
export const NFL_TEAMS_PARENT = '/app'
export const NFL_TEAM_PARENT = '/app/nfl'

export const NFL_COPY = {
  emptyTitle: 'No players found',
  emptyBody: 'No fantasy-relevant players on this roster yet.',
} as const

/** "AFC East · Bye week 7" — the band's second line. */
export function teamMetaLine(division: string, byeWeek: number | null): string {
  return byeWeek != null ? `${division} · Bye week ${byeWeek}` : division
}

/** "24 fantasy players" / "1 fantasy player". */
export function fantasyPlayersLabel(n: number): string {
  return `${n} fantasy player${n === 1 ? '' : 's'}`
}

/** ADP to one decimal, as desktop; a dash when the player has none. */
export function adpText(adp: number | null): string {
  return adp != null && Number.isFinite(Number(adp)) ? Number(adp).toFixed(1) : DASH
}

export type RosterStatusTone = 'warn' | 'negative' | 'quiet'

/**
 * The feed's designation, as desktop's Status column shows it: injuries in
 * their tone (Questionable / Doubtful orange; Out, IR, PUP, Suspended red —
 * the profile's pill words), any other non-Active status (Inactive, …) as
 * plain text. Active is the default and says nothing.
 */
export function rosterStatus(status: string | null): { label: string; tone: RosterStatusTone } | null {
  const pill = statusPill(status)
  if (pill) return pill
  const s = status?.trim()
  if (!s || s.toLowerCase() === 'active') return null
  return { label: s, tone: 'quiet' }
}

/** The row's second line: the jersey number ("#17") and the status. A
 *  defense has no number; a row with neither has no second line. */
export function rosterRowMeta(p: Pick<RosterPlayer, 'jersey_number' | 'position' | 'status'>): {
  number: string | null
  status: { label: string; tone: RosterStatusTone } | null
} {
  const number = !isDefense(p.position) && p.jersey_number != null ? `#${p.jersey_number}` : null
  return { number, status: rosterStatus(p.status) }
}
