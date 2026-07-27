'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'

import { notificationHref } from './notification-href'

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Notifications page feed — the rail notifications panel language at page
 * width: flush rows on n-4 hairlines inside a flat white card, accent dot
 * for unread, mono timestamps. Real data via the existing
 * `/api/notifications` hooks; opening the page clears the unread state.
 */
export function NotificationsFeed() {
  const { data, isLoading, isError } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0

  // Opening the page clears the unread state (and the bell badge).
  useEffect(() => {
    if (unreadCount > 0) markRead.mutate(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount])

  if (isLoading && notifications.length === 0) {
    return (
      <Card>
        <ul>
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 border-b border-n-4 px-card-pad py-3 last:border-0"
            >
              <Skeleton className="mt-1 h-1.5 w-1.5 rounded-pill" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Icon name="info-circle" size={16} className="text-negative-strong" />
        <p className="text-h5 text-ink">Couldn&apos;t load notifications</p>
        <p className="max-w-md text-[13px] font-medium text-negative-strong">
          Something went wrong fetching your notifications. Refresh to try again.
        </p>
      </Card>
    )
  }

  if (notifications.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Icon name="notification" size={16} className="text-n-3" />
        <p className="text-h5 text-ink">No notifications yet</p>
        <p className="max-w-md text-[13px] font-medium text-n-3">
          When someone you pin updates their list, you&apos;ll hear about it here.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <ul>
        {notifications.map((n) => (
          <NotificationRow key={n.id} notification={n} />
        ))}
      </ul>
    </Card>
  )
}

function NotificationRow({ notification: n }: { notification: NotificationItem }) {
  const href = notificationHref(n)

  const body = (
    <div
      className={cn(
        'flex items-start gap-2.5 px-card-pad py-3 transition-colors duration-200 ease-linear',
        href && 'hover:bg-n-4',
      )}
    >
      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill',
          n.read ? 'bg-transparent' : 'bg-accent',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[13px] leading-snug text-ink',
            n.read ? 'font-medium' : 'font-bold',
          )}
        >
          {n.title}
        </p>
        {n.body && (
          <p className="mt-0.5 text-[12px] font-medium text-n-3">{n.body}</p>
        )}
        <p className="fs-num mt-0.5 text-[11px] font-medium text-n-3">
          {relativeTime(n.created_at)}
        </p>
      </div>
    </div>
  )

  return (
    <li className="border-b border-n-4 last:border-0">
      {href ? <Link href={href}>{body}</Link> : body}
    </li>
  )
}
