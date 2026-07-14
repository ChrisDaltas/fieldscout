'use client'

import Link from 'next/link'

import { AccountMenu } from '@/components/layout/account-menu'
import { TopSearch } from '@/components/layout/top-search'
import { Wordmark } from '@/components/shared/wordmark'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'
import { useNotifications } from '@/hooks/use-notifications'
import { useUIStore } from '@/stores/ui-store'

interface TopNavProps {
  variant?: 'app' | 'guest'
}

/**
 * White top bar — 1px ink bottom border, wordmark left. In the app shell it
 * renders on mobile only (desktop nav lives in the sidebar + rail); on guest
 * pages it renders at every width. Signed in: search trigger, quick
 * new-list (app only), notifications bell, account. Signed out: sign in /
 * sign up.
 */
export function TopNav({ variant = 'app' }: TopNavProps) {
  const { user } = useAuth()
  const isSignedIn = Boolean(user)
  const showAppNav = isSignedIn && variant === 'app'
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)
  const setSeedPlayerId = useUIStore((s) => s.setCreateListSeedPlayerId)

  return (
    <header className="sticky top-0 z-40 flex h-header shrink-0 items-center gap-2 border-b border-ink bg-white px-4 lg:px-6">
      <Link href={isSignedIn ? '/app' : '/'} className="shrink-0">
        <Wordmark className="text-[15px] text-ink" />
      </Link>

      {isSignedIn ? (
        <>
          <div className="ml-auto min-w-0 max-w-xs flex-1">
            <TopSearch />
          </div>
          {showAppNav && (
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="New list"
              title="New list"
              onClick={() => {
                setSeedPlayerId(null)
                setCreateListOpen(true)
              }}
            >
              <Icon name="plus" size={14} />
            </Button>
          )}
          <NotificationBell />
          <AccountMenu variant="topbar" />
        </>
      ) : (
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="blue" size="sm" asChild>
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      )}
    </header>
  )
}

/** Bell with a lime unseen-count chip. Polls via React Query (see
 *  useNotifications). Lime = "look here"; the control itself stays neutral. */
function NotificationBell() {
  const { data } = useNotifications()
  const unread = data?.unreadCount ?? 0
  return (
    <Link
      href="/app/notifications"
      aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      className="relative inline-flex h-btn-md w-btn-md shrink-0 items-center justify-center rounded-sm text-ink transition-colors duration-200 ease-linear hover:bg-n-4 hover:text-accent"
    >
      <Icon name="notification" size={14} />
      {unread > 0 && (
        <span className="fs-num absolute right-0 top-0 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-pill border border-ink bg-brand px-1 text-[9px] font-bold leading-none text-ink">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
