import type { Metadata } from 'next'

import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { MobilePersonProfile } from '@/components/mobile/profile/person-profile'
import { userProfileHref } from '@/components/shared/username-link-ops'

interface PageProps {
  params: Promise<{ username: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params
  return { title: `@${username} · FieldScout` }
}

/**
 * A person's profile as a PHONE screen, inside the app (`phoneProfileHref`).
 * The phone layout opens every username here — never the public
 * `/u/[username]`, which is the desktop layout with no dock, no Back and no
 * dark mode on a phone. That public page stays the server-rendered one for
 * search engines, signed-out visitors and desktop: a desktop visit here goes
 * there, and so does a signed-out one (middleware).
 */
export default async function PhonePersonProfilePage({ params }: PageProps) {
  const { username } = await params
  return (
    <ByLayout
      desktop={<DesktopRedirect href={userProfileHref(username)} />}
      mobile={<MobilePersonProfile username={username} />}
    />
  )
}
