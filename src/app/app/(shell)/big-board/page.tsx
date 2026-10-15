import { BigBoardDashboard } from '@/components/big-board/big-board-dashboard'
import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileRankingsRedirect } from '@/components/mobile/rankings/mobile-rankings'

/**
 * The Big Board — the evergreen cross-position VIEW of rankings (now → rest
 * of season). The ranking *activity* (pre-draft + weekly) lives on the
 * Rankings page at /app/weekly-ranks. On mobile there is one Rankings area
 * (FieldScout Mobile handoff), so this route hands over to it.
 */
export default function BigBoardPage() {
  return (
    <ByLayout
      desktop={
        <>
          <PageHeader title="Big Board" />
          <BigBoardDashboard />
        </>
      }
      mobile={<MobileRankingsRedirect />}
    />
  )
}
