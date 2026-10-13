'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Crest } from '@/components/leagues/league-cells'
import {
  filterNotifications,
  isFieldScoutNotice,
  notificationIcon,
  notificationLeagueId,
  notificationSource,
} from '@/components/layout/rail/notifications-panel-ops'
import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { notificationHref } from '@/components/notifications/notification-href'
import {
  NOTIFICATION_TONE,
  notificationKind,
  relativeTime,
} from '@/components/notifications/notifications-feed'
import { FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  const { data, isLoading, isError, refetch } = useNotifications()
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
        error={isError}
        onRetry={() => void refetch()}
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
  error = false,
  onRetry,
  leagues,
  filter,
  onFilter,
  onOpen,
}: {
  notifications: NotificationItem[]
  loading: boolean
  /** The read failed — an error state with Retry, never the empty state (R1500). */
  error?: boolean
  onRetry?: () => void
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
        <div className="shrink-0 border-b border-n-4 px-3 py-2.5" data-notif-filters>
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
                  'inline-flex h-btn-sm items-center rounded-pill px-0.5 transition-colors duration-100 ease-linear',
                  filter === l.id ? 'bg-accent-soft shadow-ring-accent' : 'hover:bg-surface-hover',
                )}
                data-notif-filter={l.id}
              >
                <Crest name={l.name} src={l.avatar_url} className="h-5 w-5 rounded-[6px]" />
              </button>
            ))}
          </div>
          {filterName && (
            <p className="mt-2 text-[10px] font-medium text-n-6" data-notif-filter-note>
              Only {filterName}. Field Scout notifications are hidden.
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[5px]" data-rail-scroll>
        {loading && notifications.length === 0 && (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-[9px] p-[9px]">
                <Skeleton className="h-6 w-6 rounded-[7px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && notifications.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 px-4 py-10 text-center" data-notif-error>
            <p className="text-[11px] font-medium text-n-6">Couldn&apos;t load notifications.</p>
            <Button variant="stroke" size="sm" onClick={onRetry} data-notif-retry>
              Retry
            </Button>
          </div>
        )}

        {!loading && !(error && notifications.length === 0) && shown.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-[9px] pb-[17px] pt-[15px] text-center" data-notif-empty>
            <Icon name="notification" size={14} className="text-n-7" />
            <p className="text-[11px] font-medium text-n-6">
              {filterName
                ? `Nothing from ${filterName} in your recent notifications`
                : 'No notifications yet'}
            </p>
          </div>
        )}

        {shown.map((n) => {
          const leagueId = notificationLeagueId(n)
          const kind = notificationKind(n.type)
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onOpen(n)}
              className="flex w-full items-start gap-[9px] rounded-[9px] p-[9px] text-left transition-colors duration-100 ease-linear hover:bg-surface-sunken"
              data-notif-row={n.id}
              data-notif-read={n.read ? 'true' : 'false'}
            >
              {leagueId ? (
                <Crest
                  name={names.get(leagueId) ?? 'League'}
                  src={avatars.get(leagueId) ?? null}
                  className="rounded-[7px]"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-surface-control text-ink"
                  data-notif-icon={notificationIcon(n.type)}
                >
                  <Icon name={notificationIcon(n.type)} size={12} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {isFieldScoutNotice(n) && (
                  <span className="block text-[10px] font-bold text-accent" data-notif-from-fieldscout>
                    From FieldScout
                  </span>
                )}
                <span className="flex items-center gap-[5px]">
                  <span className={cn('shrink-0 whitespace-nowrap text-[10px] font-bold', NOTIFICATION_TONE[kind.tone])}>
                    {kind.label}
                  </span>
                  <span className="fs-num ml-auto min-w-0 truncate text-[10px] font-medium text-n-6" data-notif-source>
                    {notificationSource(leagueId, names)} · {relativeTime(n.created_at)}
                  </span>
                  {!n.read && (
                    <span aria-label="Unread" className="h-1.5 w-1.5 shrink-0 rounded-pill bg-accent" data-notif-unread />
                  )}
                </span>
                <span
                  className={cn(
                    'block text-[11px] leading-[1.45] text-ink',
                    n.read ? 'font-medium' : 'font-bold',
                  )}
                  data-notif-title
                >
                  {n.title}
                </span>
                {n.body && (
                  <span className="block truncate text-[11px] font-medium leading-[1.45] text-n-3">
                    {n.body}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
