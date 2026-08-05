'use client'

import Link from 'next/link'

import { DevProMenuItem } from '@/components/dev/dev-pro-menu-item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

interface AccountMenuProps {
  collapsed?: boolean
  /**
   * `sidebar` (default) renders the existing avatar + name + username row.
   * `topbar` renders an avatar-only compact button suited for the top nav.
   */
  variant?: 'sidebar' | 'topbar'
}

/**
 * Account control — round avatar trigger that opens the white ink-bordered
 * menu panel. Renders in the rail strip (ink) and the mobile top bar (page
 * grey), so the trigger keeps its own surface-neutral hover.
 */
export function AccountMenu({ collapsed = false, variant = 'sidebar' }: AccountMenuProps) {
  const { user, profile, signOut } = useAuth()
  const { toast } = useToast()
  const isTopbar = variant === 'topbar'
  const isCompact = isTopbar || collapsed

  if (!profile) {
    // Session exists but the profile failed to load (usually a stale token
    // that can no longer refresh). A /login link here dead-ends — middleware
    // bounces signed-in users straight back. Offer the escape hatch instead:
    // log out, which clears the stuck session client-side.
    if (user) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className={cn(
                'flex h-btn-md items-center gap-2 rounded-sm px-2 text-[13px] font-bold transition-opacity duration-200 ease-linear hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                isCompact && 'w-btn-md justify-center px-0',
              )}
            >
              <Icon name="profile" size={14} />
              {!isCompact && <span>Account</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side={isTopbar ? 'bottom' : 'top'} sideOffset={8} className="w-64">
            <DropdownMenuLabel>
              Your session looks stale — log out and back in to fix it.
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={signOut}
              className="cursor-pointer"
            >
              <Icon name="transfer" size={14} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    return (
      <Link
        href="/login"
        className={cn(
          'flex h-btn-md items-center gap-2 rounded-sm px-2 text-[13px] font-bold transition-opacity duration-200 ease-linear hover:opacity-80',
          isCompact && 'w-btn-md justify-center px-0',
        )}
        title={isCompact ? 'Sign in' : undefined}
      >
        <Icon name="profile" size={14} />
        {!isCompact && <span>Sign in</span>}
      </Link>
    )
  }

  // The handle is the only name we render for a person (ruling 2026-08-05).
  const handle = `@${profile.username}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          title={isCompact ? handle : undefined}
          className={cn(
            'flex items-center rounded-sm transition-opacity duration-200 ease-linear hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            isTopbar
              ? 'h-btn-md w-btn-md justify-center'
              : collapsed
                ? 'h-btn-md w-btn-md justify-center px-0'
                : 'h-9 w-full gap-2.5 px-2 text-left hover:bg-n-4 hover:opacity-100',
          )}
        >
          {/* !rounded-pill: the base Avatar's rounded-sm survives twMerge
              (custom token), so force the people-are-round rule here. */}
          <UserAvatar
            src={profile.avatar_url}
            name={profile.username}
            className="h-7 w-7 shrink-0 !rounded-pill"
          />
          {!isCompact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold leading-tight text-ink">
                {handle}
              </p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={isTopbar ? 'bottom' : 'top'}
        sideOffset={8}
        className="w-56"
      >
        <DropdownMenuLabel>
          <p className="text-[13px] font-bold leading-tight text-ink">{handle}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/stats">
            <Icon name="chart" size={14} />
            My stats
          </Link>
        </DropdownMenuItem>
        {/* TODO(live-draft): route to the league workspace once batch D ships it. */}
        {featureFlags.leagues && (
          <DropdownMenuItem
            onSelect={() =>
              toast({
                title: 'Leagues are on the way',
                description:
                  'League workspaces arrive with the live draft update.',
              })
            }
          >
            <Icon name="cup" size={14} />
            My leagues
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/app/styleguide">
            <Icon name="layers" size={14} />
            Style guide
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Icon name="setup" size={14} />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {!profile.is_pro && (
          // Pro moment — accent blue, never lime.
          <DropdownMenuItem asChild>
            <Link href="/app/settings/billing" className="font-bold text-accent focus:text-accent">
              <Icon name="star" size={14} />
              Upgrade to Pro
            </Link>
          </DropdownMenuItem>
        )}
        <DevProMenuItem isPro={Boolean(profile.is_pro)} />
        <DropdownMenuItem
          variant="destructive"
          onClick={signOut}
          className="cursor-pointer"
        >
          <Icon name="transfer" size={14} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
