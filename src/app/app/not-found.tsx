import Link from 'next/link'

import { PlaceholderPage } from '@/components/shared/placeholder-page'
import { Button } from '@/components/ui/button'

/**
 * 404 boundary for signed-in routes. Renders INSIDE the app shell, so the nav
 * survives and the user is never stranded.
 *
 * This also catches the launch-scope gates (src/lib/feature-flags.ts): a
 * flagged-off surface calls notFound() from its layout, and existing users
 * with a bookmark or history entry into Big Board / Rankings / Community land
 * here rather than on Next's bare error page.
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
