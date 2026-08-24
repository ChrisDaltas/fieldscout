import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/**
 * Release gate: every `/app/mocks` route — the practice home, and the room
 * and report MP.6/MP.8 add beside it — is unreachable, even by direct URL,
 * until the **mock-drafts** flag is on (MP task MP.5; D231).
 *
 * **`featureFlags.mockDrafts`, never `featureFlags.leagues` (E79).** Practice
 * is released on its own schedule: with the leagues flag off this subtree
 * still renders. That is the whole reason `/app/mocks` is a route family of
 * its own rather than a page under `/app/leagues`, where
 * `(room)/leagues/layout.tsx` would redirect it out from under this gate
 * (D231(3a)/R470). Pinned in `src/lib/route-groups.test.ts`.
 *
 * `redirect('/app')` rather than `notFound()` — the shipped leagues gates'
 * behaviour, copied so a gated FieldScout surface behaves one way.
 */
export default function MocksGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.mockDrafts) redirect('/app')
  return <>{children}</>
}
