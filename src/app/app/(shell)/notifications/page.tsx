import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileNotifications } from '@/components/mobile/notifications/mobile-notifications'
import { NotificationsFeed } from '@/components/notifications/notifications-feed'

export default function NotificationsPage() {
  return (
    <ByLayout
      desktop={
        <div className="max-w-2xl">
          {/* An explicit title on the standard header (F577, D487) — not the
              route-title fallback. */}
          <PageHeader title="Notifications" />
          <NotificationsFeed />
        </div>
      }
      mobile={<MobileNotifications />}
    />
  )
}
