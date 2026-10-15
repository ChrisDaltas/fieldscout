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
 *  - Waiver results (`league_waiver_claim`, migration 150: `league_id` +
 *    `status` won / lost / failed), which the shared helper leaves inert →
 *    the league's Transactions screen: "My moves" for a won claim (the add
 *    is there); league-wide otherwise, where the claim's winner shows.
 *  - Everything else: the shared target, or none.
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
  if (leagueId && n.type === 'league_waiver_claim') {
    return transactionsHref(leagueId, { mine: data?.status === 'won' })
  }
  return notificationHref(n)
}
