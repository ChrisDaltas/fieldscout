import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface LeagueDetailPageProps {
  params: Promise<{ leagueId: string }>
}

export default async function LeagueDetailPage({
  params,
}: LeagueDetailPageProps) {
  const { leagueId } = await params
  return (
    <PlaceholderPage
      title="League detail"
    >
      League ID: <span className="font-mono text-xs">{leagueId}</span>
    </PlaceholderPage>
  )
}
