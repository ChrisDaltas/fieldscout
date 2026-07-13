import { BigBoardDashboard } from '@/components/big-board/big-board-dashboard'
import { PageHeader } from '@/components/layout/app-header'

/**
 * The Big Board — the evergreen cross-position VIEW of rankings (now → rest
 * of season). The ranking *activity* (pre-draft + weekly) lives on the
 * Rankings page at /app/weekly-ranks.
 */
export default function BigBoardPage() {
  return (
    <>
      <PageHeader title="Big Board" />
      <BigBoardDashboard />
    </>
  )
}
