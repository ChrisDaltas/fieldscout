import { listCommentsHref } from '@/components/mobile/lists/lists-routes'
import type { NotificationItem } from '@/hooks/use-notifications'
import { featureFlags } from '@/lib/feature-flags'

/** Admin › Reports (Community launch plan C10) — desktop only. */
export const ADMIN_REPORTS_HREF = '/app/admin/reports'

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
  // F438 (M5 L.D3.7): every trade notification (148 / 151 / 155 / 156 —
  // `league_trade_proposed` / `_accepted` / `_rejected` / `_cancelled` /
  // `_countered` / `_executed` / `_deferred` / `_expired` / `_invalid` /
  // `_vetoed` / `_commissioner`; `trade_notify_team_internal` stamps the
  // league id) → that league's trade center, where the trade's state and
  // reason are shown.
  if (n.type.startsWith('league_trade_') && typeof data?.league_id === 'string' && data.league_id !== '') {
    return `/app/leagues/${data.league_id}/trades`
  }
  // M5 L.D3.13 (161, D425): a re-scored week whose result changed for the
  // manager (`league_week_rescored`) → that league's home, where the
  // standings and the league's post about the re-score are.
  if (n.type === 'league_week_rescored' && typeof data?.league_id === 'string' && data.league_id !== '') {
    return `/app/leagues/${data.league_id}`
  }
  // M6 L.E2.2 (172, D453): a stat correction changed the manager's result
  // (`stat_correction_result`) → that league's home, where the league's post
  // about the correction and the standings are (the corrections view is L.E2.4's).
  if (n.type === 'stat_correction_result' && typeof data?.league_id === 'string' && data.league_id !== '') {
    return `/app/leagues/${data.league_id}`
  }
  // Gap list #13 (192): the commissioner changed the league's note
  // (`league_commissioner_note`) → that league's home, where the note is
  // pinned at the top (desktop League Home; the phone's League tab).
  if (n.type === 'league_commissioner_note' && typeof data?.league_id === 'string' && data.league_id !== '') {
    return `/app/leagues/${data.league_id}`
  }
  // M8 L.G1.2 (185, D516): a hand-written FieldScout notice
  // (`operator_notice`) → its link, which is always a page INSIDE the app
  // (the verb refuses anything else; re-checked here so a bad row can never
  // send the user off-site); a league notice with no link → that league's home.
  if (n.type === 'operator_notice') {
    if (typeof data?.link === 'string' && isInAppPath(data.link)) return data.link
    if (typeof data?.league_id === 'string' && data.league_id !== '') return `/app/leagues/${data.league_id}`
    return null
  }
  // Community launch plan C10 (214): "New reports to review", an admin's
  // alert → Admin › Reports. A fixed address, never the row's data: the
  // page is admins-only and rides the Community switch, so while it's off
  // the row stays plain text rather than leading to "not found".
  if (n.type === 'content_report') {
    return featureFlags.community ? ADMIN_REPORTS_HREF : null
  }
  // Someone commented on your list (`list_comment`, 213 — the alert goes to
  // the list's owner, so this is his own list) → that list, opened on its
  // comments: the phone's List view with its Comments sheet up, desktop's
  // Lists panel on its Comments tab. Not on the Community switch — comments
  // on your own lists are Lists.
  if (n.type === 'list_comment' && typeof data?.list_id === 'string' && data.list_id !== '') {
    return listCommentsHref(data.list_id)
  }
  // List activity (the pre-existing arm): a list you saved was updated
  // (`list_updated`, 077).
  if (typeof data?.list_id === 'string' && data.list_id !== '') {
    return `/app/lists/${data.list_id}`
  }
  return null
}

/** A path inside the app: one leading "/", never "//" (another host), no
 *  scheme, whitespace or backslash — the same rule as migration 185's check. */
export function isInAppPath(link: string): boolean {
  return link.length <= 500 && /^\/([^/\\\s][^\\\s]*)?$/.test(link)
}
