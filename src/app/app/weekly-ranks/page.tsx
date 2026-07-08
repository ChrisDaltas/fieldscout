import { WeeklyRanksView } from '@/components/weekly-ranks/weekly-ranks-view'

export default function WeeklyRanksPage() {
  const currentWeek = Number(process.env.NEXT_PUBLIC_NFL_WEEK ?? 0)
  return (
    <WeeklyRanksView currentWeek={Number.isFinite(currentWeek) ? currentWeek : 0} />
  )
}
