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
      title="Start or Sit"
    >
      Question ID: <span className="font-mono text-xs">{questionId}</span>
    </PlaceholderPage>
  )
}
