import type { Metadata } from 'next'

import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { MobilePersonFollows } from '@/components/mobile/profile/person-follows'
import { DesktopPersonFollows } from '@/components/profile/person-profile-view'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { featureFlags } from '@/lib/feature-flags'

interface PageProps {
  params: Promise<{ username: string }>
}

export const metadata: Metadata = { title: 'Following · FieldScout' }

/**
 * A person's Following inside the app (`appFollowsHref`; see `../page.tsx`):
 * the phone screen, and on desktop the list inside the shell while Community
 * is on (plan C6) — else the public page, as before.
 */
export default async function PersonFollowingPage({ params }: PageProps) {
  const { username } = await params
  return (
    <ByLayout
      desktop={
        featureFlags.community ? (
          <DesktopPersonFollows username={username} kind="following" />
        ) : (
          <DesktopRedirect href={`${userProfileHref(username)}/following`} />
        )
      }
      mobile={<MobilePersonFollows username={username} kind="following" />}
    />
  )
}
