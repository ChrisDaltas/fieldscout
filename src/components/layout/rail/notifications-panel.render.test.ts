/**
 * The rail's Notifications tool (built to the Claude Design prototype's
 * ResearchRail `NotificationsTool`, Chris 2026-10-04).
 *
 *  1. The filter strip: "All" + one league-avatar chip per league; a league
 *     filter shows ONLY that league's rows, with the hidden-items note.
 *  2. Rows: league avatar or a type tile; bold + accent dot while unread;
 *     the "<League or Field Scout> · <time>" line.
 *  3. The strip badge: lime with ink text, the real unread count.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/research',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { leagues: true, messages: false } }))

import type { NotificationItem } from '@/hooks/use-notifications'

import { NotificationsBody } from './notifications-panel'
import { notificationHref } from '@/components/notifications/notification-href'

import { filterNotifications, isFieldScoutNotice, notificationIcon, notificationLeagueId, notificationSource } from './notifications-panel-ops'
import { ResearchRail } from './research-rail'

const html = (el: ReactElement, qc = new QueryClient()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

const LEAGUES = [
  { id: 'L1', name: 'Sunday League', avatar_url: null },
  { id: 'L2', name: 'Work League', avatar_url: null },
]
const AT = '2026-10-01T12:00:00Z'
const N: NotificationItem[] = [
  { id: 'n1', type: 'league_trade_proposed', title: 'Trade offer from Ann', body: null, data: { league_id: 'L1' }, read: false, created_at: AT },
  { id: 'n2', type: 'league_waiver_claim', title: 'Your claim won', body: null, data: { league_id: 'L2' }, read: true, created_at: AT },
  { id: 'n3', type: 'list_update', title: 'A list you pin changed', body: null, data: { list_id: 'x' }, read: false, created_at: AT },
]

const body = (filter: string | null) =>
  html(createElement(NotificationsBody, { notifications: N, loading: false, leagues: LEAGUES, filter, onFilter: () => {}, onOpen: () => {} }))

describe('notifications — the filter strip', () => {
  it('All + one avatar chip per league; All shows every row', () => {
    const out = body(null)
    expect(out).toMatch(/aria-pressed="true"[^>]*data-notif-filter="all"/)
    expect(out).toContain('data-notif-filter="L1"')
    expect(out).toContain('data-notif-filter="L2"')
    for (const id of ['n1', 'n2', 'n3']) expect(out).toContain(`data-notif-row="${id}"`)
    expect(out).not.toContain('data-notif-filter-note')
  })

  it('a league filter shows ONLY that league, and says platform items are hidden', () => {
    const out = body('L1')
    expect(out).toContain('data-notif-row="n1"')
    expect(out).not.toContain('data-notif-row="n2"')
    expect(out).not.toContain('data-notif-row="n3"')
    expect(out).toContain('Only Sunday League. Field Scout notifications are hidden.')
    expect(out).toMatch(/aria-pressed="true"[^>]*data-notif-filter="L1"/)
  })

  it('no leagues: no strip at all', () => {
    const out = html(createElement(NotificationsBody, { notifications: N, loading: false, leagues: [], filter: null, onFilter: () => {}, onOpen: () => {} }))
    expect(out).not.toContain('data-notif-filters')
  })

  it('pure helpers', () => {
    expect(filterNotifications(N, null)).toHaveLength(3)
    expect(filterNotifications(N, 'L2').map((n) => n.id)).toEqual(['n2'])
    expect(notificationLeagueId(N[2])).toBeNull()
    expect(notificationIcon('league_trade_executed')).toBe('transfer')
    expect(notificationIcon('league_waiver_claim')).toBe('repeat')
    expect(notificationIcon('league_draft')).toBe('list')
    expect(notificationIcon('player_injury')).toBe('info-circle')
    expect(notificationIcon('direct_message')).toBe('comments')
    expect(notificationIcon('something_else')).toBe('notification')
    expect(notificationSource(null, new Map())).toBe('Field Scout')
    expect(notificationSource('L1', new Map([['L1', 'Sunday League']]))).toBe('Sunday League')
  })
})

describe('notifications — rows', () => {
  it('unread: bold + accent dot; read: neither', () => {
    const out = body(null)
    const row = (id: string) => out.slice(out.indexOf(`data-notif-row="${id}"`), out.indexOf('</button>', out.indexOf(`data-notif-row="${id}"`)))
    expect(row('n1')).toContain('data-notif-read="false"')
    expect(row('n1')).toMatch(/font-bold" data-notif-title/)
    expect(row('n1')).toContain('data-notif-unread')
    expect(row('n2')).toContain('data-notif-read="true"')
    expect(row('n2')).toMatch(/font-medium" data-notif-title/)
    expect(row('n2')).not.toContain('data-notif-unread')
  })

  it('league rows carry the league; platform rows a type tile and "Field Scout"', () => {
    const out = body(null)
    const row = (id: string) => out.slice(out.indexOf(`data-notif-row="${id}"`), out.indexOf('</button>', out.indexOf(`data-notif-row="${id}"`)))
    expect(row('n1')).toMatch(/data-notif-source="true">Sunday League · /)
    expect(row('n1')).not.toContain('data-notif-icon')
    expect(row('n3')).toContain('data-notif-icon="document"')
    expect(row('n3')).toMatch(/data-notif-source="true">Field Scout · /)
  })
})

describe('notifications — the strip badge', () => {
  it('lime with ink text, the real unread count', () => {
    const qc = new QueryClient()
    qc.setQueryData(['notifications'], { notifications: N, unreadCount: 7 })
    const out = html(createElement(ResearchRail), qc)
    const badge = out.slice(out.indexOf('data-rail-badge="notifications"'), out.indexOf('</span>', out.indexOf('data-rail-badge="notifications"')))
    expect(badge).toContain('bg-brand')
    expect(badge).toContain('text-ink')
    expect(badge).toMatch(/>7$/)
  })

  it('no unread: no badge', () => {
    const qc = new QueryClient()
    qc.setQueryData(['notifications'], { notifications: [], unreadCount: 0 })
    expect(html(createElement(ResearchRail), qc)).not.toContain('data-rail-badge="notifications"')
  })
})

describe('notifications — failed read and filtered empty (R1500)', () => {
  it('a failed read shows an error with Retry, never "No notifications yet"', () => {
    const out = html(createElement(NotificationsBody, { notifications: [], loading: false, error: true, onRetry: () => {}, leagues: LEAGUES, filter: null, onFilter: () => {}, onOpen: () => {} }))
    expect(out).toContain('data-notif-error')
    expect(out).toContain("Couldn't load notifications.")
    expect(out).toContain('data-notif-retry')
    expect(out).toContain('>Retry</button>')
    expect(out).not.toContain('data-notif-empty')
    expect(out).not.toContain('No notifications yet')
  })

  it('a league filter with nothing says it searched the recent notifications only', () => {
    const only = N.filter((n) => n.id !== 'n2')
    const out = html(createElement(NotificationsBody, { notifications: only, loading: false, leagues: LEAGUES, filter: 'L2', onFilter: () => {}, onOpen: () => {} }))
    expect(out).toContain('data-notif-empty')
    expect(out).toContain('Nothing from Work League in your recent notifications')
    expect(out).not.toContain('data-notif-error')
  })
})

describe('notifications — FieldScout notices (M8 L.G1.2, migration 185)', () => {
  const NOTICES: NotificationItem[] = [
    { id: 'f1', type: 'operator_notice', title: 'Waivers are paused this week', body: 'A game was postponed.', data: { from: 'fieldscout', link: '/app/leagues/L1/waivers', league_id: 'L1' }, read: false, created_at: AT },
    { id: 'f2', type: 'operator_notice', title: 'Maintenance tonight', body: null, data: { from: 'fieldscout' }, read: false, created_at: AT },
  ]
  const out = html(createElement(NotificationsBody, { notifications: [...NOTICES, ...N], loading: false, leagues: LEAGUES, filter: null, onFilter: () => {}, onOpen: () => {} }))
  const row = (id: string) => out.slice(out.indexOf(`data-notif-row="${id}"`), out.indexOf('</button>', out.indexOf(`data-notif-row="${id}"`)))

  it('a notice — league or platform — carries the "From FieldScout" label above its title', () => {
    for (const id of ['f1', 'f2']) {
      expect(row(id)).toMatch(/data-notif-from-fieldscout="true">From FieldScout<\/span>.*data-notif-title/)
    }
    expect(row('f1')).toMatch(/data-notif-source="true">Sunday League · /)
    expect(row('f2')).toMatch(/data-notif-source="true">Field Scout · /)
  })

  it('no other notification gets the label', () => {
    for (const id of ['n1', 'n2', 'n3']) expect(row(id)).not.toContain('data-notif-from-fieldscout')
    expect(isFieldScoutNotice({ type: 'operator_notice', data: { from: 'someone' } })).toBe(false)
    expect(isFieldScoutNotice({ type: 'league_trade_proposed', data: { from: 'fieldscout' } })).toBe(false)
  })

  it('a notice opens its in-app link (the row hands it to onOpen → notificationHref)', () => {
    expect(notificationHref(NOTICES[0])).toBe('/app/leagues/L1/waivers')
    expect(notificationHref(NOTICES[1])).toBeNull()
  })
})
