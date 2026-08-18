import Link from 'next/link'

import { PlaceholderPage } from '@/components/shared/placeholder-page'
import { Button } from '@/components/ui/button'

/**
 * 404 boundary for the SHELL group's routes.
 *
 * **The shell arrives late, and two earlier versions of this docblock got that
 * wrong in opposite directions** (review findings F66 and R341). Measured on a
 * production build, signed in, 2026-08-18, for the case this file DOES catch
 * (`/app/nfl/ZZZ`):
 *   - **server-rendered HTML: no shell.** 17,621 bytes, `pr-rail-strip` ×0,
 *     `h-header` ×0, no sidebar links, "Back to home" ×1. (Control, same
 *     session: `/app/lists` → 200, 44,187 bytes, `pr-rail-strip` ×1,
 *     `h-header` ×2, sidebar "Home" ×2.)
 *   - **after client hydration: the shell is there.** Same URL, fresh
 *     `navigate`: DOM 34,450 bytes, `pr-rail-strip` ×1, two sidebar "Home"
 *     links, plus this page's own "Back to home".
 * So the nav does survive — but the FIRST PAINT of a 404 is chrome-less, and
 * with JS broken it stays that way. That is why the button below is not
 * decoration: it is the only exit the server actually sends.
 *
 * **What this file catches:** an explicit `notFound()` thrown by a route inside
 * `(shell)` — today that is `nfl/[team]/page.tsx:26` (unknown team code).
 *
 * **What it does NOT catch, and never did:** a genuinely unmatched URL such as
 * `/app/definitely-not-a-route`. Those fall through to `src/app/not-found.tsx`
 * (the unbranded-nav one, "Back to FieldScout"). **Neither behavior above is a
 * consequence of DR.1's route-group split** — both were re-measured on
 * `main` @ 9c81f7c (production build, same signed-in session, this file still
 * at `src/app/app/not-found.tsx`, no route groups at all): `/app/nfl/ZZZ` →
 * 404, 17,109 bytes, `pr-rail-strip` ×0 server-side and ×1 after hydration
 * (33,938-byte DOM, two sidebar "Home" links); `/app/definitely-not-a-route` →
 * 404, 18,496 bytes, root 404, `pr-rail-strip` ×0. Structurally identical to
 * this branch; the byte counts differ by tens (build id), so "byte-for-byte",
 * which an earlier revision of this comment claimed, is not the right word.
 * Recorded as PROGRESS-leagues §6 **F66** rather than fixed here, because
 * fixing it is an app-wide 404 decision and DR.1 is a route-hosting task.
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
