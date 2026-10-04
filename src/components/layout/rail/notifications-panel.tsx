'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Crest } from '@/components/leagues/league-cells'
import {
  filterNotifications,
  notificationIcon,
  notificationLeagueId,
  notificationSource,
} from '@/components/layout/rail/notifications-panel-ops'
import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { notificationHref } from '@/components/notifications/notification-href'
import { FilterChip } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeagues } from '@/hooks/use-leagues'
import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from '@/hooks/use-notifications'
import { featureFlags } from '@/lib/feature-flags'
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
 * Notifications tool — built to the prototype's ResearchRail
 * `NotificationsTool` (Chris 2026-10-04) over the real `/api/notifications`
 * data: an "All" chip plus a chip per league; rows with the league's avatar
 * (or a type tile for platform items), bold + an accent dot while unread.
 * Clicking a row marks it read and follows its link (`notificationHref`, the
 * same targets the notifications page uses).
 */
export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const router = useRouter()
  const { data, isLoading } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const [filter, setFilter] = useState<string | null>(null)

  const myLeagues = featureFlags.leagues ? (leagues.data ?? []) : []
  const leagueFilter = filter && myLeagues.some((l) => l.id === filter) ? filter : null

  const openNotification = (n: NotificationItem) => {
    if (!n.read) markRead.mutate([n.id])
    const href = notificationHref(n)
    if (href) router.push(href)
  }

  return (
    <RailPanelShell title="Notifications" onClose={onClose}>
      <NotificationsBody
        notifications={data?.notifications ?? []}
        loading={isLoading}
        leagues={myLeagues}
        filter={leagueFilter}
        onFilter={setFilter}
        onOpen={openNotification}
      />
    </RailPanelShell>
  )
}

interface LeagueChip {
  id: string
  name: string
  avatar_url: string | null
}

/** The panel's body — presentational, exported for the render tests. */
export function NotificationsBody({
  notifications,
  loading,
  leagues,
  filter,
  onFilter,
  onOpen,
}: {
  notifications: NotificationItem[]
  loading: boolean
  leagues: readonly LeagueChip[]
  filter: string | null
  onFilter: (leagueId: string | null) => void
  onOpen: (n: NotificationItem) => void
}) {
  const names = new Map(leagues.map((l) => [l.id, l.name]))
  const avatars = new Map(leagues.map((l) => [l.id, l.avatar_url]))
  const shown = filterNotifications(notifications, filter)
  const filterName = filter ? names.get(filter) : null

  return (
    <>
      {leagues.length > 0 && (
        <div className="shrink-0 border-b border-ink p-3" data-notif-filters>
          <div className="flex flex-wrap items-center gap-1">
            <FilterChip pressed={filter === null} onPressedChange={() => onFilter(null)} data-notif-filter="all">
              All
            </FilterChip>
            {leagues.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={filter === l.id}
                aria-label={`Only ${l.name}`}
                title={l.name}
                onClick={() => onFilter(filter === l.id ? null : l.id)}
                className={cn(
                  'inline-flex h-btn-sm items-center rounded-sm border px-1 transition-colors',
                  filter === l.id ? 'border-ink bg-accent-soft' : 'border-transparent hover:bg-n-4',
                )}
                data-notif-filter={l.id}
              >
                <Crest name={l.name} src={l.avatar_url} className="h-5 w-5" />
              </button>
            ))}
          </div>
          {filterName && (
            <p className="mt-2 text-[10px] font-semibold text-n-3" data-notif-filter-note>
              Only {filterName}. Field Scout notifications are hidden.
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-rail-scroll>
        {loading && notifications.length === 0 && (
          <div className="space-y-2.5 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Skeleton className="h-6 w-6" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && shown.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center" data-notif-empty>
            <Icon name="notification" size={16} className="text-n-3" />
            <p className="text-[12px] font-bold text-ink">
              {filterName ? `Nothing from ${filterName} yet` : 'No notifications yet'}
            </p>
          </div>
        )}

        {shown.map((n) => {
          const leagueId = notificationLeagueId(n)
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onOpen(n)}
              className="flex w-full items-start gap-2.5 border-b border-n-4 px-3 py-2.5 text-left transition-colors duration-200 ease-linear hover:bg-n-4"
              data-notif-row={n.id}
              data-notif-read={n.read ? 'true' : 'false'}
            >
              {leagueId ? (
                <Crest name={names.get(leagueId) ?? 'League'} src={avatars.get(leagueId) ?? null} />
              ) : (
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink bg-white text-ink"
                  data-notif-icon={notificationIcon(n.type)}
                >
                  <Icon name={notificationIcon(n.type)} size={12} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-[12px] leading-snug text-ink',
                    n.read ? 'font-medium' : 'font-bold',
                  )}
                  data-notif-title
                >
                  {n.title}
                </span>
                {n.body && (
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-n-3">
                    {n.body}
                  </span>
                )}
                <span className="fs-num mt-0.5 block text-[10px] font-medium text-n-3" data-notif-source>
                  {notificationSource(leagueId, names)} · {relativeTime(n.created_at)}
                </span>
              </span>
              {!n.read && (
                <span aria-label="Unread" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-accent" data-notif-unread />
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
