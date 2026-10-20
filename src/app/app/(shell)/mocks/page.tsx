import { MocksHome } from '@/components/draft/mocks-home'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileMocks } from '@/components/mobile/mocks/mobile-mocks'

export const metadata = { title: 'Mock drafts · FieldScout' }

/**
 * `/app/mocks` — the practice home (MP task MP.5; spec v2.16 §8.8). Every
 * mock this user launched, plus the launch affordance. Gated on
 * `featureFlags.mockDrafts` by the layout beside this file.
 *
 * Not in the nav yet — MP.9 owns the More… entries in both lists.
 *
 * The phone draws its own screen on the same read and the same launcher
 * (`MobileMocks`, gap list §4 item 110); desktop is unchanged.
 */
export default function MocksPage() {
  return <ByLayout desktop={<MocksHome />} mobile={<MobileMocks />} />
}
