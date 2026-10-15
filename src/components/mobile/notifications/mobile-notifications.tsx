'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { BackPill, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { toast } from '@/hooks/use-toast'
import { useMarkNotificationsRead, useNotifications, type NotificationItem } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'

import { mobileNotificationHref } from './mobile-notification-href'
import { NOTIF_TONE_CLASS, notificationVisual, shortTime, subLine } from './notification-visual'

/**
 * Notifications (FieldScout Mobile — m-home §2B, m-dock §2.10) over the real
 * `/api/notifications` feed (newest first, 50 at most).
 *
 * - Top bar (52px): "‹ Back" (to wherever you came from) and "Mark all read"
 *   (always shown, as designed). The 28/600 title sits under it; both stay
 *   put while the list scrolls.
 * - Rows: unread rows are tinted (gb2), bold, with a 9px blue dot. Nothing is
 *   marked read just by opening the screen — only "Mark all read", or opening
 *   a row (the app's rule on desktop: opening a notification reads it).
 * - A row opens what it is about (`mobileNotificationHref`: the desktop
 *   targets, plus a trade's own detail and a waiver result's transactions);
 *   a type with no destination just reads.
 */
export function MobileNotifications() {
  const router = useRouter()
  const { data, isPending, isError, refetch } = useNotifications()
  const markRead = useMarkNotificationsRead()
  // Read locally the moment it is tapped (the design's change is instant);
  // the server read follows and the refetch confirms it.
  const [readLocally, setReadLocally] = useState<ReadonlySet<string>>(new Set())
  const notifications = data?.notifications ?? []
  const isRead = (n: NotificationItem) => n.read || readLocally.has(n.id)

  const back = () => {
    if (window.history.length > 1) router.back()
    else router.push('/app')
  }

  const markIds = (ids: string[] | undefined, all: string[]) => {
    const prev = readLocally
    setReadLocally(new Set([...prev, ...all]))
    markRead.mutate(ids, {
      onError: () => {
        setReadLocally(prev)
        toast({ title: 'Couldn’t mark that read — try again' })
      },
    })
  }

  const markAll = () => {
    const unread = notifications.filter((n) => !isRead(n)).map((n) => n.id)
    // The server count also covers unread rows older than the 50 shown.
    if (unread.length === 0 && (data?.unreadCount ?? 0) === 0) return
    markIds(undefined, unread)
  }

  const open = (n: NotificationItem) => {
    if (!isRead(n)) markIds([n.id], [n.id])
  }

  const now = Date.now()

  return (
    <MobileScreen
      header={
        <>
          <div className="flex h-[52px] items-center gap-2 px-3">
            <BackPill onClick={back} />
            <span className="flex-1" />
            {/* 17px line box as designed; the padding grows the tap area to 31px without moving it. */}
            <button
              type="button"
              onClick={markAll}
              className="-my-[7px] px-1.5 py-[7px] text-[14px] font-semibold leading-[17px] text-accent"
            >
              Mark all read
            </button>
          </div>
          <h2 className="px-4 pb-2 text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-m-t1">
            Notifications
          </h2>
        </>
      }
    >
      {isPending ? (
        <div aria-busy="true" aria-label="Loading notifications">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex gap-3 px-4 py-3">
              <span className="size-10 flex-none rounded-full bg-m-b1" />
              <span className="flex flex-1 flex-col gap-2 pt-1">
                <span className="h-3.5 w-3/4 rounded-[14px] bg-m-b1" />
                <span className="h-3 w-1/2 rounded-[14px] bg-m-b1" />
              </span>
            </div>
          ))}
        </div>
      ) : isError && notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" role="alert">
          <p className="text-[15px] font-semibold leading-[19px] text-m-t1">Couldn’t load notifications</p>
          <p className="text-[13px] font-medium leading-[16px] text-m-t3">Check your connection and try again.</p>
          <button type="button" onClick={() => void refetch()} className="mt-1 text-[14px] font-semibold leading-[17px] text-accent">
            Try again
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold leading-[19px] text-m-t1">No notifications yet</p>
          <p className="text-[13px] font-medium leading-[1.4] text-m-t3">
            Trades, waiver results and updates to lists you follow will show up here.
          </p>
        </div>
      ) : (
        <ul>
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationRow n={n} read={isRead(n)} time={shortTime(n.created_at, now)} onOpen={() => open(n)} />
            </li>
          ))}
        </ul>
      )}
    </MobileScreen>
  )
}

function NotificationRow({ n, read, time, onOpen }: { n: NotificationItem; read: boolean; time: string; onOpen: () => void }) {
  const href = mobileNotificationHref(n)
  const visual = notificationVisual(n)
  const cls = cn('flex w-full gap-3 px-4 py-3 text-left', read ? 'bg-m-b0' : 'bg-m-gb2', 'active:bg-m-b1')
  const body = (
    <>
      <span className={cn('flex size-10 flex-none items-center justify-center rounded-full', NOTIF_TONE_CLASS[visual.tone])} aria-hidden>
        <svg viewBox="0 0 16 16" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d={visual.path} />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-[14px] leading-[1.35] text-m-t1 [text-wrap:pretty]', read ? 'font-medium' : 'font-semibold')}>
          {n.title}
          {!read && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="text-[12px] font-medium leading-[15px] text-m-t3">{subLine(n.body, time)}</span>
      </span>
      {!read && <span className="mt-1.5 size-[9px] flex-none rounded-full bg-accent" aria-hidden />}
    </>
  )
  return href ? (
    <Link href={href} onClick={onOpen} className={cls} data-notif-row={n.id} data-notif-read={read}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={cls} data-notif-row={n.id} data-notif-read={read}>
      {body}
    </button>
  )
}
