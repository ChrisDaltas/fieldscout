import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the AI expert persona profiles and posts are out of
 *  the 2026 go-live scope until they're reskinned. Redirects to the home page
 *  (not a 404): the routes shipped before the gate, so real visitors hold
 *  bookmarks into them, and a dead end reads as a broken site
 *  (`launch-scope-gates.test.ts`). These are public SEO pages, so the sitemap
 *  drops them behind the same flag. */
export default function PersonasGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.personas) redirect('/')
  return <>{children}</>
}

