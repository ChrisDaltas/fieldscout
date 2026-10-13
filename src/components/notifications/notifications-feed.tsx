'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { notificationIcon } from '@/components/layout/rail/notifications-panel-ops'
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

export function relativeTime(iso: string): string {
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

export type NotificationTone = 'accent' | 'positive' | 'caution' | 'negative' | 'neutral'

/** v7 type-label colours — semantic text tokens, never hex. */
export const NOTIFICATION_TONE: Record<NotificationTone, string> = {
  accent: 'text-accent-strong',
  positive: 'text-positive-strong',
  caution: 'text-caution-strong',
  negative: 'text-negative-strong',
  neutral: 'text-n-3',
}

/**
 * The v7 row's coloured type label ("Trade", "Waivers", "Draft" …), from the
 * notification's `type`. Display only — routing stays in `notificationHref`.
 */
export function notificationKind(type: string): { label: string; tone: NotificationTone } {
  if (type.includes('trade')) {
    if (/(vetoed|rejected|invalid|expired|cancelled)$/.test(type)) return { label: 'Trade', tone: 'negative' }
    if (/(executed|accepted)$/.test(type)) return { label: 'Trade', tone: 'positive' }
    return { label: 'Trade', tone: 'accent' }
  }
  if (type.includes('waiver') || type.includes('faab')) return { label: 'Waivers', tone: 'positive' }
  if (type.includes('draft')) return { label: 'Draft', tone: 'neutral' }
  if (type.includes('injur') || type.includes('lineup') || type.includes('lock')) return { label: 'Lineup alert', tone: 'caution' }
  if (type.includes('rescored') || type.includes('correction')) return { label: 'Scoring', tone: 'caution' }
  if (type.includes('invite')) return { label: 'Invite', tone: 'accent' }
  if (type.includes('vote')) return { label: 'Vote', tone: 'accent' }
  if (type.includes('message') || type.includes('comment') || type.includes('chat')) return { label: 'Message', tone: 'accent' }
  if (type.startsWith('list')) return { label: 'Lists', tone: 'neutral' }
  if (type.startsWith('league')) return { label: 'League', tone: 'neutral' }
  return { label: 'Field Scout', tone: 'neutral' }
}

/**
 * Notifications page feed — v7's "Needs your attention" list at page width:
 * a flat hairline card, rows on n-4 hairlines with a type tile, a coloured
 * type label + time, and an accent dot for unread. Real data via the existing
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
      <Card className="overflow-hidden">
        <ul>
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 border-t border-n-4 px-3.5 py-3 first:border-t-0">
              <Skeleton className="h-[27px] w-[27px] rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
        <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">Couldn&apos;t load notifications</p>
        <p className="max-w-md text-[11px] font-medium text-n-6">
          Something went wrong fetching your notifications. Refresh to try again.
        </p>
      </Card>
    )
  }

  if (notifications.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
        <Icon name="notification" size={16} className="text-n-7" />
        <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">No notifications yet</p>
        <p className="max-w-md text-[11px] font-medium text-n-6">
          When someone you pin updates their list, you&apos;ll hear about it here.
        </p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
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
  const kind = notificationKind(n.type)
  const icon = notificationIcon(n.type)

  const body = (
    <div
      className={cn(
        'flex items-start gap-3 px-3.5 py-3 transition-colors duration-100 ease-linear',
        href && 'hover:bg-surface-sunken',
      )}
    >
      <span
        aria-hidden
        className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-md bg-surface-control text-ink"
      >
        <Icon name={icon} size={13} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <p className="flex flex-wrap items-center gap-[7px] text-[10px] font-semibold text-n-6">
          <span className={NOTIFICATION_TONE[kind.tone]}>{kind.label}</span>
          <span className="fs-num">{relativeTime(n.created_at)}</span>
        </p>
        <p
          className={cn(
            'text-[12px] leading-[1.4] text-ink',
            n.read ? 'font-medium' : 'font-semibold',
          )}
        >
          {n.title}
        </p>
        {n.body && (
          <p className="text-[11px] font-medium leading-[1.45] text-n-3">{n.body}</p>
        )}
      </div>
      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill',
          n.read ? 'bg-transparent' : 'bg-accent',
        )}
        aria-hidden
      />
    </div>
  )

  return (
    <li className="border-t border-n-4 first:border-t-0">
      {href ? <Link href={href}>{body}</Link> : body}
    </li>
  )
}
