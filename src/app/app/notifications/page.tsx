import { NotificationsFeed } from '@/components/notifications/notifications-feed'

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl px-2 py-2">
      <h1 className="mb-4 text-2xl font-bold">Notifications</h1>
      <NotificationsFeed />
    </div>
  )
}
