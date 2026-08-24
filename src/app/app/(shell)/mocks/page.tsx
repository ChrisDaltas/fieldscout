import { MocksHome } from '@/components/draft/mocks-home'

export const metadata = { title: 'Mock drafts · FieldScout' }

/**
 * `/app/mocks` — the practice home (MP task MP.5; spec v2.16 §8.8). Every
 * mock this user launched, plus the launch affordance. Gated on
 * `featureFlags.mockDrafts` by the layout beside this file.
 *
 * Not in the nav yet — MP.9 owns the More… entries in both lists.
 */
export default function MocksPage() {
  return <MocksHome />
}
