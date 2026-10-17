import { ByLayout } from '@/components/mobile/by-layout'
import { MyStartSitScreen } from '@/components/mobile/profile/my-start-sit-screen'
import { PlaceholderPage } from '@/components/shared/placeholder-page'

/** Desktop: the placeholder. Mobile: My start/sit (FieldScout Mobile). */
export default function StartOrSitPage() {
  return (
    <ByLayout
      desktop={
        <PlaceholderPage
          title="Start or sit"
          description="Coming soon — put your toughest lineup call to the community and watch the start/sit split settle it."
        />
      }
      mobile={<MyStartSitScreen />}
    />
  )
}
