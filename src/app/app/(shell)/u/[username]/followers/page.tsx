import type { Metadata } from 'next'

import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { MobilePersonFollows } from '@/components/mobile/profile/person-follows'
import { userProfileHref } from '@/components/shared/username-link-ops'

interface PageProps {
  params: Promise<{ username: string }>
}

export const metadata: Metadata = { title: 'Followers · FieldScout' }

/**
 * A person's Followers as a PHONE screen, inside the app (`phoneFollowsHref`;
 * see `../page.tsx`). A desktop visit goes to the public page.
 */
export default async function PhonePersonFollowersPage({ params }: PageProps) {
  const { username } = await params
  return (
    <ByLayout
      desktop={<DesktopRedirect href={`${userProfileHref(username)}/followers`} />}
      mobile={<MobilePersonFollows username={username} kind="followers" />}
    />
  )
}
