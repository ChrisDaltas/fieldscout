/**
 * /app/explore/latest — For you's "Latest" → See all (Chris, 2026-10-16).
 * The phone gets the Latest page; the desktop layout has no such page, so a
 * desktop visit goes to Community instead of a phone-only screen. (The
 * explore layout's Community launch flag gates it with the rest of
 * Community — pinned below.)
 */
import { describe, expect, it, vi } from 'vitest'

class RedirectSignal extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`)
  }
}
const flags = vi.hoisted(() => ({ community: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
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
  it('phone: the Latest page; desktop: sent to Community', () => {
    const page = CommunityLatestPage() as unknown as {
      type: unknown
      props: { desktop: { type: unknown; props: unknown }; mobile: { type: unknown } }
    }
    expect(page.type).toBe(ByLayout)
    expect(page.props.mobile.type).toBe(MobileCommunityLatest)
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
