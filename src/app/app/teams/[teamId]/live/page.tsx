import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface TeamLivePageProps {
  params: Promise<{ teamId: string }>
}

export default async function TeamLivePage({ params }: TeamLivePageProps) {
  const { teamId } = await params
  return (
    <PlaceholderPage
      title="Live mode"
      description="Coming with FieldScout leagues — live scoring for your matchup, play by play."
    >
      Team ID: <span className="fs-num text-[11px]">{teamId}</span>
    </PlaceholderPage>
  )
}
