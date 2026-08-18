import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface TeamDetailPageProps {
  params: Promise<{ teamId: string }>
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { teamId } = await params
  return (
    <PlaceholderPage
      title="Team detail"
      description="Coming with FieldScout leagues — your roster, matchup, and record will live here."
    >
      Team ID: <span className="fs-num text-[11px]">{teamId}</span>
    </PlaceholderPage>
  )
}
