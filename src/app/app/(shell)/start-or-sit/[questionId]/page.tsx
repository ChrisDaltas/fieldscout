import { ByLayout } from '@/components/mobile/by-layout'
import { MobileStartSitQuestion } from '@/components/mobile/profile/start-sit-pages'
import { PlaceholderPage } from '@/components/shared/placeholder-page'

interface StartOrSitDetailPageProps {
  params: Promise<{ questionId: string }>
}

/** Desktop: the placeholder. Mobile: the question itself — its vote split on
 *  the real row (gap list §4 item 112). */
export default async function StartOrSitDetailPage({
  params,
}: StartOrSitDetailPageProps) {
  const { questionId } = await params
  return (
    <ByLayout
      desktop={
        <PlaceholderPage
          title="Start or sit"
          description="Coming soon — community votes land here with the start/sit split."
        >
          Question ID: <span className="fs-num text-[11px]">{questionId}</span>
        </PlaceholderPage>
      }
      mobile={<MobileStartSitQuestion questionId={questionId} />}
    />
  )
}
