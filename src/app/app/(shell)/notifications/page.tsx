import { PageHeader } from '@/components/layout/app-header'
import { NotificationsFeed } from '@/components/notifications/notifications-feed'

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      {/* An explicit title on the standard header (F577, D487) — not the
          route-title fallback. */}
      <PageHeader title="Notifications" />
      <NotificationsFeed />
    </div>
  )
}
