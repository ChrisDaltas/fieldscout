'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LogoTile, Wordmark } from '@/components/landing/fieldscout-logo'
import { AccountMenu } from '@/components/layout/account-menu'
import { TopSearch } from '@/components/layout/top-search'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'
import { useLeagues } from '@/hooks/use-leagues'
import { useNotifications } from '@/hooks/use-notifications'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useRailStore } from '@/stores/rail-store'
import { useUIStore } from '@/stores/ui-store'

interface TopNavProps {
  variant?: 'app' | 'guest'
}

/**
 * v7 top bar — 48px, white, light hairline below; spans the whole app above
 * the left rail, the page and the right-side bar. Logo tile + wordmark left;
 * in the app, the league switcher beside it; search, notifications, Create
 * and the account avatar on the right. Guest pages get search (signed in) or
 * sign in / sign up.
 *
 * Below `lg` the same bar is the phone top bar: the league switcher and the
 * search field drop out (search lives in the bottom tabs), and the bell links
 * to the notifications page instead of opening the right-side panel.
 */
export function TopNav({ variant = 'app' }: TopNavProps) {
  const { user } = useAuth()
  const isSignedIn = Boolean(user)
  const showAppNav = isSignedIn && variant === 'app'

  return (
    <header className="sticky top-0 z-40 flex h-header shrink-0 items-center gap-[5px] border-b border-n-4 bg-white pl-[15px] pr-3.5">
      <Link
        href={isSignedIn ? '/app' : '/'}
        aria-label="FieldScout home"
        className="flex shrink-0 items-center gap-2 pr-[7px] transition-opacity hover:opacity-70"
      >
        <LogoTile size={24} />
        <Wordmark height={11} />
      </Link>

      {showAppNav && featureFlags.leagues && <LeagueSwitcher />}

      <div className="flex-1" />

      {isSignedIn ? (
        <>
          <div className={cn('hidden w-[220px] min-w-0', variant === 'guest' ? 'block' : 'lg:block')}>
            <TopSearch />
          </div>
          <NotificationBell />
          {showAppNav && <CreateMenu />}
          <div className="ml-[3px]">
            <AccountMenu variant="topbar" />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="md" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="blue" size="md" asChild>
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      )}
    </header>
  )
}

/** Two-letter initials for a league crest tile. */
function leagueInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const ROLE_LABEL: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

/** League crest — v7 rounded square; the league's avatar when it has one. */
function Crest({ name, avatarUrl, size }: { name: string; avatarUrl: string | null; size: 20 | 26 }) {
  const box = size === 20 ? 'size-5 rounded-[6px]' : 'size-[26px] rounded-[7px]'
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny crest; next/image is overkill
    return <img src={avatarUrl} alt="" className={cn('shrink-0 object-cover', box)} />
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-ink text-[9px] font-bold text-white',
        box,
      )}
    >
      {leagueInitials(name)}
    </span>
  )
}

/**
 * v7 league switcher — a 27px chip beside the logo. Reads "Your leagues"
 * outside a league and the league's crest + name inside one; the menu lists
 * the viewer's real memberships. Hidden when they're in no league.
 */
function LeagueSwitcher() {
  const pathname = usePathname()
  const { data: leagues } = useLeagues({ enabled: featureFlags.leagues })
  const mine = leagues ?? []
  if (mine.length === 0) return null

  const current = mine.find((lg) => pathname.startsWith(`/app/leagues/${lg.id}`))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'ml-[7px] hidden h-btn-md shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[9px] pr-[9px] text-[11px] font-semibold text-ink shadow-ring-chip transition-colors hover:bg-surface-sunken data-[state=open]:bg-surface-sunken lg:flex',
            current ? 'pl-[3px]' : 'pl-2.5',
          )}
        >
          {current && <Crest name={current.name} avatarUrl={current.avatar_url} size={20} />}
          <span className="max-w-[180px] truncate">{current ? current.name : 'Your leagues'}</span>
          <Icon name="sort" size={10} className="text-n-6" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={5} className="w-[247px]">
        <DropdownMenuLabel>Your leagues</DropdownMenuLabel>
        {mine.map((lg) => (
          <DropdownMenuItem key={lg.id} asChild>
            <Link href={`/app/leagues/${lg.id}`} className="gap-[9px]">
              <Crest name={lg.name} avatarUrl={lg.avatar_url} size={26} />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate">{lg.name}</span>
                <span className="truncate text-[10px] font-medium text-n-6">
                  {ROLE_LABEL[lg.my_role] ?? lg.my_role}
                </span>
              </span>
              {current?.id === lg.id && <Icon name="check" size={11} className="text-accent" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/leagues">All leagues</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Bell with v7's blue unseen-count pill. On desktop it opens the
 * notifications panel in the right-side bar; on a phone (no right-side bar)
 * it goes to the notifications page.
 */
function NotificationBell() {
  const { data } = useNotifications()
  const unread = data?.unreadCount ?? 0
  const openTool = useRailStore((s) => s.openTool)
  const toggleTool = useRailStore((s) => s.toggleTool)
  const label = unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'
  const badge =
    unread > 0 ? (
      <span className="fs-num absolute -right-0.5 -top-0.5 inline-flex h-count-chip min-w-count-chip items-center justify-center rounded-pill bg-accent px-1 text-[9px] font-bold leading-none text-white">
        {unread > 9 ? '9+' : unread}
      </span>
    ) : null
  const base =
    'relative ml-[3px] inline-flex size-btn-md shrink-0 items-center justify-center rounded-pill text-ink transition-colors hover:bg-surface-hover'

  return (
    <>
      <Link href="/app/notifications" aria-label={label} className={cn(base, 'lg:hidden')}>
        <Icon name="notification" size={15} />
        {badge}
      </Link>
      <button
        type="button"
        aria-label={label}
        aria-pressed={openTool === 'notifications'}
        title="Notifications"
        onClick={() => toggleTool('notifications')}
        className={cn(base, 'hidden lg:inline-flex', openTool === 'notifications' && 'bg-surface-hover')}
      >
        <Icon name="notification" size={15} />
        {badge}
      </button>
    </>
  )
}

/**
 * v7 Create menu — a secondary "Create" button whose menu holds the things
 * you can start from anywhere. Only entries the app already supports appear:
 * a new list always; leagues and practice drafts with their release flags.
 */
function CreateMenu() {
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)
  const setSeedPlayerId = useUIStore((s) => s.setCreateListSeedPlayerId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="stroke" size="md" className="ml-0.5 max-sm:w-btn-md max-sm:px-0" aria-label="Create">
          <Icon name="plus" />
          <span className="max-sm:hidden">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={7} className="w-[221px]">
        <DropdownMenuItem
          onSelect={() => {
            setSeedPlayerId(null)
            setCreateListOpen(true)
          }}
        >
          <Icon name="list" size={13} />
          New list
        </DropdownMenuItem>
        {featureFlags.leagues && (
          <DropdownMenuItem asChild>
            <Link href="/app/leagues">
              <Icon name="cup" size={13} />
              Create or join a league
            </Link>
          </DropdownMenuItem>
        )}
        {featureFlags.mockDrafts && (
          <DropdownMenuItem asChild>
            <Link href="/app/mocks">
              <Icon name="rocket" size={13} />
              Start a mock draft
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
