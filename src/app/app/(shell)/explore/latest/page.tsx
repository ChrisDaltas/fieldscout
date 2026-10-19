import { Suspense } from 'react'

import { ByLayout } from '@/components/mobile/by-layout'
import { COMMUNITY_HREF } from '@/components/mobile/community/community-ops'
import { MobileCommunityLatest } from '@/components/mobile/community/latest-screen'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

export const metadata = { title: 'Latest · FieldScout' }

/**
 * Community's Latest page (FieldScout Mobile; For you's "Latest" shelf → See
 * all, Chris 2026-10-16): every public list and ranking, newest first. Gated
 * with the rest of Community by the explore layout's launch flag. The
 * desktop layout has no such page: a desktop visit goes to Community.
 */
export default function CommunityLatestPage() {
  return (
    <ByLayout
      desktop={<DesktopRedirect href={COMMUNITY_HREF} />}
      mobile={
        // Streams on its own, as Community's does, so reading the NFL week
        // never holds up the desktop redirect.
        <Suspense fallback={null}>
          <MobileLatestRoute />
        </Suspense>
      }
    />
  )
}

/** The phone's Latest page with the app's NFL week (a weekly ranking's
 *  Duplicate needs it). */
async function MobileLatestRoute() {
  const currentWeek = await getCurrentNflWeek()
  return <MobileCommunityLatest currentWeek={currentWeek} />
}
