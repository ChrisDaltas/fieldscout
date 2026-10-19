/**
 * /app/explore/latest — For you's "Latest" → See all (Chris, 2026-10-16).
 * The phone gets the Latest page; the desktop layout has no such page, so a
 * desktop visit goes to Community instead of a phone-only screen. (The
 * explore layout's Community launch flag gates it with the rest of
 * Community — pinned below.)
 */
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'

class RedirectSignal extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`)
  }
}
const flags = vi.hoisted(() => ({ community: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
vi.mock('@/lib/sports-data/nfl-state', () => ({ getCurrentNflWeek: async () => 7 }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to)
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore/latest',
  useSearchParams: () => new URLSearchParams(),
}))

import { ByLayout } from '@/components/mobile/by-layout'
import { MobileCommunityLatest } from '@/components/mobile/community/latest-screen'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'

import CommunityGate from '../layout'
import CommunityLatestPage from './page'

describe('/app/explore/latest', () => {
  it('phone: the Latest page, with the NFL week; desktop: sent to Community', async () => {
    const page = CommunityLatestPage() as unknown as {
      type: unknown
      props: {
        desktop: { type: unknown; props: unknown }
        mobile: { type: unknown; props: { children: { type: () => Promise<{ type: unknown; props: unknown }> } } }
      }
    }
    expect(page.type).toBe(ByLayout)
    // The phone's page streams on its own (Suspense) and reads the NFL week —
    // a weekly ranking's Duplicate in the detail needs it.
    expect(page.props.mobile.type).toBe(Suspense)
    const latest = await page.props.mobile.props.children.type()
    expect(latest.type).toBe(MobileCommunityLatest)
    expect(latest.props).toStrictEqual({ currentWeek: 7 })
    expect(page.props.desktop.type).toBe(DesktopRedirect)
    expect(page.props.desktop.props).toStrictEqual({ href: '/app/explore' })
  })

  it('bounces with the rest of Community while Community is switched off', () => {
    flags.community = false
    expect(() => CommunityGate({ children: null })).toThrow(RedirectSignal)
    flags.community = true
    expect(() => CommunityGate({ children: null })).not.toThrow()
  })
})
