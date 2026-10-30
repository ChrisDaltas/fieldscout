'use client'

import { profileHrefFor } from '@/components/shared/username-link-ops'
import { useLayoutModeValue } from '@/hooks/use-layout-mode'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Where a link to a person goes from here: their profile inside the app
 * (`/app/u/…`) in the phone layout, and in the desktop layout while
 * Community is on (plan C6); their public page everywhere else (`/u/…` —
 * desktop while Community is off, and every page outside the app). The
 * server and the hydration pass answer the public page; the app's own link
 * follows once the layout is known.
 */
export function useProfileHref(username: string): string {
  return profileHrefFor(username, useLayoutModeValue(), featureFlags.community)
}
