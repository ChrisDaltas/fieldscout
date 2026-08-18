import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface StartOrSitDetailPageProps {
  params: Promise<{ questionId: string }>
}

export default async function StartOrSitDetailPage({
  params,
}: StartOrSitDetailPageProps) {
  const { questionId } = await params
  return (
    <PlaceholderPage
      title="Start or sit"
      description="Coming soon — community votes land here with the start/sit split."
    >
      Question ID: <span className="fs-num text-[11px]">{questionId}</span>
    </PlaceholderPage>
  )
}
