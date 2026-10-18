import { Suspense } from 'react'

import { ByLayout } from '@/components/mobile/by-layout'
import { MobileProfile } from '@/components/mobile/profile/mobile-profile'
import { MyStatsPage } from '@/components/profile/my-stats-page'
import { featureFlags } from '@/lib/feature-flags'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

/**
 * Desktop: My stats. Mobile: the FieldScout Mobile Profile screen (account
 * root — Dark/Light pill, identity, "My stuff"; `?tab=` picks the segment).
 * `MobileProfile` reads `useSearchParams`, hence its Suspense boundary.
 *
 * The NFL week (the Rankings page's own read, cached for an hour) names the
 * phone's ranking rows and marks played weeks Finalized; it is read only
 * while Rankings is switched on (otherwise there are no ranking rows).
 */
export default async function ProfilePage() {
  const currentWeek = featureFlags.weeklyRanks ? await getCurrentNflWeek() : 0
  return (
    <ByLayout
      desktop={<MyStatsPage />}
      mobile={
        <Suspense>
          <MobileProfile currentWeek={currentWeek} />
        </Suspense>
      }
    />
  )
}
