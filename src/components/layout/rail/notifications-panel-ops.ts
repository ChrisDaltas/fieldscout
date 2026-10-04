/**
 * Pure derivations for the rail's Notifications tool (built to the Claude
 * Design prototype's ResearchRail `NotificationsTool`, Chris 2026-10-04).
 */
import type { IconName } from '@/components/ui/icon'
import type { NotificationItem } from '@/hooks/use-notifications'

/** The league a notification belongs to, from its own `data.league_id`
 *  (every league notification stamps it) — null for a platform item. */
export function notificationLeagueId(n: Pick<NotificationItem, 'data'>): string | null {
  const id = n.data?.league_id
  return typeof id === 'string' && id !== '' ? id : null
}

/** "All" (null) shows everything; a league filter shows ONLY that league's
 *  notifications — platform-wide items are hidden. */
export function filterNotifications<T extends Pick<NotificationItem, 'data'>>(items: readonly T[], leagueId: string | null): T[] {
  if (leagueId === null) return [...items]
  return items.filter((n) => notificationLeagueId(n) === leagueId)
}

/** The icon tile for a row with no league avatar, by notification type. */
export function notificationIcon(type: string): IconName {
  if (type.includes('trade')) return 'transfer'
  if (type.includes('waiver')) return 'repeat'
  if (type.includes('draft')) return 'list'
  if (type.includes('injur')) return 'info-circle'
  if (type.includes('message') || type.includes('comment')) return 'comments'
  if (type.startsWith('list')) return 'document'
  return 'notification'
}

/** The muted source line's first half: the league's name, or Field Scout. */
export function notificationSource(leagueId: string | null, leagueNames: ReadonlyMap<string, string>): string {
  if (leagueId === null) return 'Field Scout'
  return leagueNames.get(leagueId) ?? 'League'
}
