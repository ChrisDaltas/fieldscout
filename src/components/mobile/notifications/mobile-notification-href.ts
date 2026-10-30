/**
 * Where a mobile Notifications row goes (m-home §3 / m-dock §2.10 "Row
 * taps"): the app's shared target (`notificationHref`, the desktop rail's),
 * sharpened where the mobile app has a closer screen. Pure.
 *
 *  - Trade rows (`league_trade_*`, migrations 148 / 151 / 174 stamp
 *    `trade_id` + `league_id`) → that trade's detail over the league's
 *    Trades page (`?trade=<id>` — Accept / Decline / Counter while it is
 *    pending), the design's row-0 door. A row without a trade id keeps the
 *    shared target (the Trades page).
 *  - Every waiver notification, which the shared helper leaves inert → the
 *    league's Transactions screen, "My moves" (gap list §3 #12): a result
 *    (`league_waiver_claim`, migration 150: `league_id` + `status` won /
 *    lost / invalid) — a won claim is there as the add, a lost or failed
 *    one as its own row with the reason — and the commissioner placing,
 *    cancelling or reordering a claim on your team
 *    (`league_waiver_claim_commissioner`, migration 145), whose pending
 *    claims are listed there.
 *  - An admin's "New reports to review" (`content_report`, 214) → none:
 *    Admin › Reports is desktop only.
 *  - Everything else: the shared target, or none — including a commissioner
 *    note change (`league_commissioner_note`, migration 192), whose shared
 *    target is the league home: on the phone, the League tab with the note
 *    pinned at the top.
 */
import { transactionsHref } from '@/components/mobile/league/league/league-tab-ops'
import { notificationHref } from '@/components/notifications/notification-href'
import type { NotificationItem } from '@/hooks/use-notifications'

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function mobileNotificationHref(n: Pick<NotificationItem, 'type' | 'data'>): string | null {
  const data = (n.data ?? null) as Record<string, unknown> | null
  const leagueId = str(data?.league_id)
  if (leagueId && n.type.startsWith('league_trade_')) {
    const tradeId = str(data?.trade_id)
    if (tradeId) return `/app/leagues/${leagueId}/trades?trade=${encodeURIComponent(tradeId)}`
  }
  if (leagueId && (n.type === 'league_waiver_claim' || n.type === 'league_waiver_claim_commissioner')) {
    return transactionsHref(leagueId, { mine: true })
  }
  // Community launch plan C10: an admin's "New reports to review" — Admin ›
  // Reports is desktop only (the phone has no Admin screen), so on the phone
  // the row is plain text and says where to look (`mobileNotificationBody`).
  if (n.type === 'content_report') return null
  return notificationHref(n)
}

/** The row's grey line: the notification's own body — or, for an admin's
 *  "New reports to review" (which carries none), where to review them. */
export function mobileNotificationBody(n: Pick<NotificationItem, 'type' | 'body'>): string | null {
  if (n.type === 'content_report' && !n.body?.trim()) return 'Review them in Admin, on desktop'
  return n.body
}
