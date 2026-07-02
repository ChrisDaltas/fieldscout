import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface TeamLivePageProps {
  params: Promise<{ teamId: string }>
}

export default async function TeamLivePage({ params }: TeamLivePageProps) {
  const { teamId } = await params
  return (
    <PlaceholderPage
      title="Live Mode"
    >
      Team ID: <span className="font-mono text-xs">{teamId}</span>
    </PlaceholderPage>
  )
}
