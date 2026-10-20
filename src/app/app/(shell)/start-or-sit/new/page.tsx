import { ByLayout } from '@/components/mobile/by-layout'
import { MobileAskStartSit } from '@/components/mobile/profile/start-sit-pages'
import { PlaceholderPage } from '@/components/shared/placeholder-page'

/** Desktop: the placeholder. Mobile: Ask a question, the same "coming soon"
 *  in the phone's language (gap list §4 item 112). */
export default function NewStartOrSitPage() {
  return (
    <ByLayout
      desktop={
        <PlaceholderPage
          title="Post a start or sit"
          description="Coming soon — pick two players, ask the room, and get a verdict before lock."
        />
      }
      mobile={<MobileAskStartSit />}
    />
  )
}
