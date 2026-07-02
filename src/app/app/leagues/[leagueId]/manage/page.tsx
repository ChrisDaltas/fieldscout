import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface LeagueManagePageProps {
  params: Promise<{ leagueId: string }>
}

export default async function LeagueManagePage({
  params,
}: LeagueManagePageProps) {
  const { leagueId } = await params
  return (
    <PlaceholderPage
      title="Manage league"
    >
      League ID: <span className="font-mono text-xs">{leagueId}</span>
    </PlaceholderPage>
  )
}
