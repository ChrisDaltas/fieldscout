import { WeeklyRanksView } from '@/components/weekly-ranks/weekly-ranks-view'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'

export default async function WeeklyRanksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [currentWeek, { tab }] = await Promise.all([getCurrentNflWeek(), searchParams])
  return (
    <WeeklyRanksView
      currentWeek={currentWeek}
      initialTab={tab === 'pre' ? 'pre' : undefined}
    />
  )
}
