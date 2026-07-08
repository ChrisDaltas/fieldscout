'use client'

import { useRouter } from 'next/navigation'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'

function relativeTime(iso: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  )
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

interface NotificationsPanelProps {
  onClose: () => void
}

/**
 * Notifications tool — real data via the existing `/api/notifications` hooks.
 * Clicking a row marks it read (the API accepts per-id marks) and follows the
 * list link when the notification carries one.
 */
export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const router = useRouter()
  const { data, isLoading } = useNotifications()
  const markRead = useMarkNotificationsRead()

  const notifications = data?.notifications ?? []

  const openNotification = (n: NotificationItem) => {
    if (!n.read) markRead.mutate([n.id])
    if (n.data?.list_id) router.push(`/app/lists/${n.data.list_id}`)
  }

  return (
    <RailPanelShell title="Notifications" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading && notifications.length === 0 && (
          <div className="space-y-2.5 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Skeleton className="mt-1 h-1.5 w-1.5 rounded-pill" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && notifications.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="notification" size={16} className="text-n-3" />
            <p className="text-[12px] font-bold text-ink">No notifications yet</p>
            <p className="text-[11px] font-medium text-n-3">
              When someone you pin updates their list, it lands here.
            </p>
          </div>
        )}

        {notifications.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => openNotification(n)}
            className="flex w-full items-start gap-2.5 border-b border-n-4 px-3 py-2.5 text-left transition-colors duration-200 ease-linear hover:bg-n-4"
          >
            <span
              aria-hidden
              className={cn(
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-pill',
                n.read ? 'bg-transparent' : 'bg-accent',
              )}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block text-[12px] leading-snug text-ink',
                  n.read ? 'font-medium' : 'font-bold',
                )}
              >
                {n.title}
              </span>
              {n.body && (
                <span className="mt-0.5 block truncate text-[11px] font-medium text-n-3">
                  {n.body}
                </span>
              )}
              <span className="fs-num mt-0.5 block text-[10px] font-medium text-n-3">
                {relativeTime(n.created_at)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </RailPanelShell>
  )
}
