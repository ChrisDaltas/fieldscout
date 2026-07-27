import type { NotificationItem } from '@/hooks/use-notifications'

/**
 * Deep-link destination for a notification row (or `null` → the row renders as
 * inert text). M1 task L.A2.6 discharges **F30**: a `league_invite`
 * notification carries the invitee's own claim `token`, so it links to the
 * pre-auth `/join/[token]` page this task builds (the destination now exists —
 * before it, `notifications-feed` built hrefs from `list_id` only, so a
 * username-invite notification was dead text).
 *
 * The `league_member` removal/leave arm (data `{league_id, team_id, event}`,
 * no token) is discharged by **L.A2.7** (F34): it links to the league home
 * (`/app/leagues/[league_id]`) — the destination that task builds. A removed /
 * departed member may no longer have RLS access to the league, in which case
 * the home degrades to its "couldn't load" state (§7.2.1 allows re-invite);
 * the notification's job is only to point at the league it concerns.
 *
 * Pure (no time/DOM/fetch) so the "renders as a link" contract is pinned
 * without a render.
 */
export function notificationHref(n: Pick<NotificationItem, 'type' | 'data'>): string | null {
  const data = n.data
  // F30: league_invite → the invitee's /join/[token] claim page.
  if (n.type === 'league_invite' && typeof data?.token === 'string' && data.token !== '') {
    return `/join/${encodeURIComponent(data.token)}`
  }
  // F34: league_member (removed / left / franchise retired) → the league home.
  if (n.type === 'league_member' && typeof data?.league_id === 'string' && data.league_id !== '') {
    return `/app/leagues/${data.league_id}`
  }
  // List activity (the pre-existing arm).
  if (typeof data?.list_id === 'string' && data.list_id !== '') {
    return `/app/lists/${data.list_id}`
  }
  return null
}
