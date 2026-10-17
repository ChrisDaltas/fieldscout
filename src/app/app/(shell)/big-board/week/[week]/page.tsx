import { WeeklyBigBoardView } from '@/components/big-board/weekly-big-board-view'
import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileRankingsScreen, MobileInvalidWeek } from '@/components/mobile/rankings/mobile-rankings'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

interface WeeklyBigBoardPageProps {
  params: Promise<{ week: string }>
}

export default async function WeeklyBigBoardPage({
  params,
}: WeeklyBigBoardPageProps) {
  const [{ week }, currentWeek] = await Promise.all([params, getCurrentNflWeek()])
  const weekNum = Number(week)
  const validWeek = Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= 18
  return (
    <ByLayout
      desktop={
        <>
          <PageHeader title="Rankings" />
          <WeeklyBigBoardView
            weekNumber={Number.isFinite(weekNum) ? weekNum : NaN}
            currentWeek={currentWeek}
          />
        </>
      }
      mobile={
        validWeek ? (
          <MobileRankingsScreen currentWeek={currentWeek} initialEdit={`w${weekNum}`} />
        ) : (
          <MobileInvalidWeek />
        )
      }
    />
  )
}
