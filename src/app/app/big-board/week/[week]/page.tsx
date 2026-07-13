import { WeeklyBigBoardView } from '@/components/big-board/weekly-big-board-view'
import { PageHeader } from '@/components/layout/app-header'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

interface WeeklyBigBoardPageProps {
  params: Promise<{ week: string }>
}

export default async function WeeklyBigBoardPage({
  params,
}: WeeklyBigBoardPageProps) {
  const [{ week }, currentWeek] = await Promise.all([params, getCurrentNflWeek()])
  const weekNum = Number(week)
  return (
    <>
      <PageHeader title="Rankings" />
      <WeeklyBigBoardView
        weekNumber={Number.isFinite(weekNum) ? weekNum : NaN}
        currentWeek={currentWeek}
      />
    </>
  )
}
