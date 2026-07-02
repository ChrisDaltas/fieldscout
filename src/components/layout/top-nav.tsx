'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  Home,
  ListOrdered,
  ListPlus,
  Plus,
  Shield,
  SlidersHorizontal,
  Trophy,
} from 'lucide-react'

import { AccountMenu } from '@/components/layout/account-menu'
import { TopSearch } from '@/components/layout/top-search'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/use-auth'
import { useNotifications } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface TopNavProps {
  variant?: 'app' | 'guest'
}

interface CenterNavItem {
  label: string
  href: string
  icon: typeof Home
  matchPrefix?: string
  exact?: boolean
}

const CENTER_NAV: CenterNavItem[] = [
  { label: 'Home', href: '/app', icon: Home, exact: true },
  { label: 'Lists', href: '/app/lists', icon: ListOrdered, matchPrefix: '/app/lists' },
  { label: 'Players', href: '/app/players', icon: Shield, matchPrefix: '/app/players' },
  { label: 'My Stats', href: '/app/profile', icon: BarChart3, matchPrefix: '/app/profile' },
]

function isCenterActive(pathname: string, item: CenterNavItem): boolean {
  if (item.exact) return pathname === item.href || pathname === '/app/explore'
  return Boolean(item.matchPrefix && pathname.startsWith(item.matchPrefix))
}

export function TopNav({ variant = 'app' }: TopNavProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const isSignedIn = Boolean(user)
  const showAppNav = isSignedIn && variant === 'app'

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 bg-background px-4 lg:px-6">
      <Link
        href={isSignedIn ? '/app' : '/'}
        className="font-switzer text-base font-bold tracking-tight text-foreground"
      >
        FieldScout
      </Link>

      {/* Center cluster: all nav items left of the search bar, Spotify-style. */}
      <div className="flex flex-1 items-center justify-center gap-1 px-2 sm:gap-2 sm:px-6">
        {showAppNav && (
          <div className="hidden items-center gap-1 lg:flex">
            {CENTER_NAV.map((item) => (
              <CenterNavLink
                key={item.href}
                item={item}
                active={isCenterActive(pathname, item)}
              />
            ))}
          </div>
        )}

        {isSignedIn && <TopSearch />}
      </div>

      <div className="flex items-center gap-1">
        {isSignedIn ? (
          <>
            {showAppNav && <CreateMenu />}
            <NotificationBell />
            <AccountMenu variant="topbar" />
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="invisible" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="font-semibold">
                Sign up
              </Button>
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

/** "+ Create" dropdown — New List today; League and Scoring System are
 *  placeholders until those features ship. */
function CreateMenu() {
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)
  const setSeedPlayerId = useUIStore((s) => s.setCreateListSeedPlayerId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" className="font-semibold">
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 border-bg-elevated-2 bg-bg-elevated"
      >
        <DropdownMenuItem
          onSelect={() => {
            setSeedPlayerId(null)
            setCreateListOpen(true)
          }}
        >
          <ListPlus className="mr-2 h-4 w-4" />
          New List
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="justify-between">
          <span className="flex items-center">
            <Trophy className="mr-2 h-4 w-4" />
            League
          </span>
          <SoonBadge />
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="justify-between">
          <span className="flex items-center">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Scoring System
          </span>
          <SoonBadge />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Bell with an unread-count badge. Polls via React Query (see useNotifications). */
function NotificationBell() {
  const { data } = useNotifications()
  const unread = data?.unreadCount ?? 0
  return (
    <Link
      href="/app/notifications"
      aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      className="relative"
    >
      <Button
        variant="invisible"
        size="icon"
        className="h-9 w-9 text-text-secondary hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
      </Button>
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}

function SoonBadge() {
  return (
    <span className="rounded-full bg-bg-elevated-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
      Soon
    </span>
  )
}

function CenterNavLink({
  item,
  active,
}: {
  item: CenterNavItem
  active: boolean
}) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            active
              ? 'bg-bg-elevated-2 text-foreground'
              : 'text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}
