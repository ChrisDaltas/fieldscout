import { WeeklyBigBoardView } from '@/components/big-board/weekly-big-board-view'
import { PageHeader } from '@/components/layout/app-header'

interface WeeklyBigBoardPageProps {
  params: Promise<{ week: string }>
}

export default async function WeeklyBigBoardPage({
  params,
}: WeeklyBigBoardPageProps) {
  const { week } = await params
  const weekNum = Number(week)
  const currentWeek = Number(process.env.NEXT_PUBLIC_NFL_WEEK ?? 0)
  return (
    <>
      <PageHeader title="Rankings" />
      <WeeklyBigBoardView
        weekNumber={Number.isFinite(weekNum) ? weekNum : NaN}
        currentWeek={Number.isFinite(currentWeek) ? currentWeek : 0}
      />
    </>
  )
}
