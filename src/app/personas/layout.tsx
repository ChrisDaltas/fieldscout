import { notFound } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the AI expert persona profiles and posts are out of
 *  the 2026 go-live scope until they're reskinned. 404 (not a redirect) so a
 *  gated surface looks exactly like a route that doesn't exist — these are
 *  public SEO pages, so the sitemap drops them behind the same flag. */
export default function PersonasGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.personas) notFound()
  return <>{children}</>
}
