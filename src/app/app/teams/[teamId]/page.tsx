import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface TeamDetailPageProps {
  params: Promise<{ teamId: string }>
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { teamId } = await params
  return (
    <PlaceholderPage
      title="Team detail"
    >
      Team ID: <span className="font-mono text-xs">{teamId}</span>
    </PlaceholderPage>
  )
}
