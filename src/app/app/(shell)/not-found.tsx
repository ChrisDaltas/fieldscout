import Link from 'next/link'

import { PlaceholderPage } from '@/components/shared/placeholder-page'
import { Button } from '@/components/ui/button'

/**
 * 404 boundary for the SHELL group's routes. Renders inside the app shell, so
 * the nav survives and the user is never stranded — for the cases it actually
 * catches, which is narrower than this comment used to claim.
 *
 * **What it catches:** an explicit `notFound()` thrown by a route inside
 * `(shell)` — today that is `nfl/[team]/page.tsx:26` (unknown team code).
 *
 * **What it does NOT catch, and never did:** a genuinely unmatched URL such as
 * `/app/definitely-not-a-route`. Those fall through to `src/app/not-found.tsx`
 * (the unbranded-nav one, "Back to FieldScout"). **This is pre-existing, not a
 * consequence of DR.1's route-group split** — measured both ways on
 * 2026-08-18: on `main` @ 9c81f7c, with this file at `src/app/app/not-found.tsx`
 * and no route groups at all, `GET /app/definitely-not-a-route` already
 * rendered the root 404 ("Back to FieldScout", no `pr-rail-strip`), byte-for-
 * byte the same as it does now. Recorded as PROGRESS-leagues §6 **F66** rather
 * than fixed here, because fixing it is an app-wide 404 decision and DR.1 is a
 * route-hosting task.
 *
 * The launch-scope gates (src/lib/feature-flags.ts) do NOT rely on this file:
 * they `redirect()` rather than `notFound()`, deliberately — see the rationale
 * pinned in `src/lib/launch-scope-gates.test.ts`.
 */
export default function AppNotFound() {
  return (
    <PlaceholderPage
      title="Not here"
      description="This page doesn't exist, or it's a feature we've tucked away while it gets rebuilt."
    >
      <Button asChild variant="stroke" size="md" className="mt-3">
        <Link href="/app">Back to home</Link>
      </Button>
    </PlaceholderPage>
  )
}
