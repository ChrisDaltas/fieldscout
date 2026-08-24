import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/**
 * Release gate for the practice ROOM's route space — `/app/mocks/[mockId]`
 * and whatever lands beside it — unreachable, even by direct URL, until the
 * **mock-drafts** flag is on (MP task MP.6; D231/D243).
 *
 * **This is `(shell)/mocks/layout.tsx`'s twin, and the duplication is the
 * point rather than an oversight** — it is the same relationship
 * `(room)/leagues/layout.tsx` has with `(shell)/leagues/layout.tsx`. Route
 * groups do not nest: the room needs the chrome-free `(room)` frame, so its
 * `/app/mocks` URLs cannot sit under the shell's gate and would otherwise be
 * the one part of the practice surface the flag does not cover. The two
 * files must stay identical in effect; `src/lib/route-groups.test.ts` pins
 * both.
 *
 * **`featureFlags.mockDrafts`, never `featureFlags.leagues` (E79/R470).**
 * The whole reason this route exists is that `(room)/leagues/layout.tsx:18`
 * hard-redirects every `/app/leagues` URL with the leagues flag off — the
 * mock room included — and a different flag on a different layout could not
 * reach past it (D231(3a)). Gating this on the leagues flag would rebuild
 * the coupling MP.6 exists to remove.
 *
 * A RELEASE gate, never an isolation one (D231(2)): a mock's separation from
 * a real league is RLS and `league_id IS NULL`, server-side, whatever this
 * flag says.
 *
 * `redirect('/app')` rather than `notFound()` — the shipped gates' behaviour,
 * copied so a gated FieldScout surface behaves one way.
 */
export default function MockRoomGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.mockDrafts) redirect('/app')
  return <>{children}</>
}
