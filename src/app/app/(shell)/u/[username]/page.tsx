import type { Metadata } from 'next'

import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { MobilePersonProfile } from '@/components/mobile/profile/person-profile'
import { DesktopPersonProfile } from '@/components/profile/person-profile-view'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { featureFlags } from '@/lib/feature-flags'

interface PageProps {
  params: Promise<{ username: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params
  return { title: `@${username} · FieldScout` }
}

/**
 * A person's profile inside the app (`appProfileHref`).
 *
 *  - **Phone:** always its phone screen (audit profile-1) — never the public
 *    `/u/[username]`, which is the desktop layout with no dock, no Back and
 *    no dark mode on a phone.
 *  - **Desktop, Community on** (plan C6): the profile inside the desktop
 *    shell, with Follow and Share — every username in the app opens it.
 *  - **Desktop, Community off:** the public page, as before C6 (desktop
 *    links don't come here then; a pasted phone address still might).
 *
 * The public page stays the server-rendered one for search engines and
 * signed-out visitors: a signed-out visit here goes there (middleware).
 */
export default async function PersonProfilePage({ params }: PageProps) {
  const { username } = await params
  return (
    <ByLayout
      desktop={
        featureFlags.community ? (
          <DesktopPersonProfile username={username} />
        ) : (
          <DesktopRedirect href={userProfileHref(username)} />
        )
      }
      mobile={<MobilePersonProfile username={username} />}
    />
  )
}
