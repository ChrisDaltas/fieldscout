/**
 * Community launch plan C10: an admin's "New reports to review" alert (214's
 * `content_report`, data `{ link: '/app/admin/reports' }`) opens Admin ›
 * Reports on desktop — a fixed address, never the row's data. While
 * Community is off (the page doesn't exist then) and on the phone (no Admin
 * screen) it is plain text; the phone says where to review them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ community: true }))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    featureFlags: {
      ...actual.featureFlags,
      get community() {
        return flags.community
      },
    },
  }
})

import { mobileNotificationBody, mobileNotificationHref } from '@/components/mobile/notifications/mobile-notification-href'

import { notificationIcon } from '@/components/layout/rail/notifications-panel-ops'

import { notificationKind } from './notifications-feed'
import { ADMIN_REPORTS_HREF, notificationHref } from './notification-href'

const ALERT = { type: 'content_report', data: { link: '/app/admin/reports' }, body: null }

afterEach(() => {
  flags.community = true
})

describe('the report alert', () => {
  it('desktop: opens Admin › Reports', () => {
    expect(ADMIN_REPORTS_HREF).toBe('/app/admin/reports')
    expect(notificationHref(ALERT)).toBe('/app/admin/reports')
  })

  it('…at the fixed address, whatever the row carries', () => {
    expect(notificationHref({ type: 'content_report', data: { link: 'https://elsewhere.example' } })).toBe('/app/admin/reports')
    expect(notificationHref({ type: 'content_report', data: null })).toBe('/app/admin/reports')
  })

  it('while Community is off: plain text (the page isn’t there)', () => {
    flags.community = false
    expect(notificationHref(ALERT)).toBeNull()
  })

  it('phone: plain text, saying to review them on desktop', () => {
    expect(mobileNotificationHref(ALERT)).toBeNull()
    expect(mobileNotificationBody(ALERT)).toBe('Review them in Admin, on desktop')
    // Every other row keeps its own body.
    expect(mobileNotificationBody({ type: 'list_comment', body: 'Nice list' })).toBe('Nice list')
  })

  it('desktop’s type label and the rail’s flag', () => {
    expect(notificationKind('content_report')).toEqual({ label: 'Reports', tone: 'caution' })
    expect(notificationIcon('content_report')).toBe('flag')
  })
})
