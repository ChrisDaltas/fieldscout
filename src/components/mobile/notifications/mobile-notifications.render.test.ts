/**
 * Mobile Notifications (m-home §2B / m-dock §2.10) over a seeded feed: the
 * top bar, the 28px title, unread vs read rows, the "{sub} · {time}" line,
 * and each row's door.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/notifications',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))

import type { NotificationItem } from '@/hooks/use-notifications'

import { MobileNotifications } from './mobile-notifications'
import { NOTIF_PATH } from './notification-visual'

const AT = new Date(Date.now() - 8 * 60_000).toISOString()
const N: NotificationItem[] = [
  { id: 'n1', type: 'league_trade_proposed', title: 'Trade offer from Marcus', body: 'Darnell Mooney + 2026 3rd for James Conner', data: { league_id: 'L1', trade_id: 'T1' } as never, read: false, created_at: AT },
  { id: 'n2', type: 'league_waiver_claim', title: 'Waiver claim won: Kendrick Bourne', body: null, data: { league_id: 'L1', status: 'won' } as never, read: true, created_at: AT },
  { id: 'n3', type: 'list_updated', title: 'A list you follow changed', body: null, data: { list_id: 'x' }, read: false, created_at: AT },
]

const render = (notifications: NotificationItem[] | null) => {
  const qc = new QueryClient()
  if (notifications) qc.setQueryData(['notifications'], { notifications, unreadCount: notifications.filter((n) => !n.read).length })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileNotifications)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

describe('mobile Notifications', () => {
  it('top bar, title and rows', () => {
    const out = render(N)
    expect(out).toContain('Back')
    expect(out).toContain('Mark all read')
    expect(out).toMatch(/text-\[28px\][^"]*">Notifications</)
    expect(out).toContain('Darnell Mooney + 2026 3rd for James Conner · 8m')
  })

  it('unread rows are tinted, bold and dotted; read rows are plain', () => {
    const out = render(N)
    const row = (id: string) => out.slice(out.indexOf(`data-notif-row="${id}"`) - 200, out.indexOf(`data-notif-row="${id}"`) + 1200)
    expect(row('n1')).toContain('bg-m-gb2')
    expect(row('n1')).toContain('font-semibold')
    expect(row('n1')).toContain('size-[9px]')
    expect(out).toMatch(/class="[^"]*bg-m-b0[^"]*"[^>]*data-notif-row="n2"/)
  })

  it('each row opens what it is about', () => {
    const out = render(N)
    // A trade offer opens that trade's detail (Accept / Decline / Counter).
    expect(out).toContain('href="/app/leagues/L1/trades?trade=T1"')
    // A won waiver claim opens My moves.
    expect(out).toMatch(/<a [^>]*data-notif-row="n2"[^>]*href="\/app\/leagues\/L1\/activity\/transactions\?mine=1"/)
    expect(out).toContain('href="/app/lists/x"')
  })

  it('213: a new comment on your list — the bubble glyph, the title, a link to the list', () => {
    const out = render([
      { id: 'c1', type: 'list_comment', title: '@sam commented on Waiver sleepers', body: null, data: { list_id: 'L9', actor_id: 'u2' }, read: false, created_at: AT },
    ])
    expect(out).toContain('@sam commented on Waiver sleepers')
    expect(out).toMatch(/<a [^>]*data-notif-row="c1"[^>]*href="\/app\/lists\/L9"/)
    expect(out).toContain(`d="${NOTIF_PATH.comment}"`)
  })

  it('empty and loading states', () => {
    expect(render([])).toContain('No notifications yet')
    expect(render(null)).toContain('aria-busy="true"')
  })
})
