'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useEffect } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'

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

export function NotificationsFeed() {
  const { data, isLoading } = useNotifications()
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
      <ul className="space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-20" />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-bg-elevated-2 bg-bg-elevated px-6 py-16 text-center">
        <Bell className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm font-medium text-foreground">No notifications yet</p>
        <p className="max-w-xs text-sm text-text-secondary">
          When someone you pin updates their list, you&apos;ll hear about it here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-1">
      {notifications.map((n) => (
        <NotificationRow key={n.id} notification={n} />
      ))}
    </ul>
  )
}

function NotificationRow({ notification: n }: { notification: NotificationItem }) {
  const href = n.data?.list_id ? `/app/lists/${n.data.list_id}` : null

  const body = (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg px-3 py-3 transition-colors',
        href && 'hover:bg-bg-elevated-2',
        !n.read && 'bg-bg-elevated',
      )}
    >
      <span
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          n.read ? 'bg-transparent' : 'bg-destructive',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{n.title}</p>
        {n.body && <p className="text-sm text-text-secondary">{n.body}</p>}
        <p className="mt-0.5 text-xs text-text-tertiary">
          {relativeTime(n.created_at)}
        </p>
      </div>
    </div>
  )

  return <li>{href ? <Link href={href}>{body}</Link> : body}</li>
}
