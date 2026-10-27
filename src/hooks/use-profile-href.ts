'use client'

import { profileHrefFor } from '@/components/shared/username-link-ops'
import { useLayoutModeValue } from '@/hooks/use-layout-mode'

/**
 * Where a link to a person goes from here: their phone screen inside the app
 * in the phone layout (`/app/u/…` — dock, Back, light/dark), their public
 * page everywhere else (`/u/…` — desktop, and every page outside the app).
 * The server and the hydration pass answer the public page; a phone screen
 * mounts after the layout is known, so it links to the phone screen at once.
 */
export function useProfileHref(username: string): string {
  return profileHrefFor(username, useLayoutModeValue())
}
