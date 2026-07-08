import { BigBoardGrid } from '@/components/big-board/big-board-grid'
import { PageHeader } from '@/components/layout/app-header'

export default function BigBoardPage() {
  const currentWeek = Number(process.env.NEXT_PUBLIC_NFL_WEEK ?? 0)
  return (
    <>
      <PageHeader title="Rankings" />
      <BigBoardGrid currentWeek={Number.isFinite(currentWeek) ? currentWeek : 0} />
    </>
  )
}
