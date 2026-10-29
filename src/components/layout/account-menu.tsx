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
import { featureFlags } from '@/lib/feature-flags'
import { PRO_UPSELL_ENABLED } from '@/lib/pro-upsell'
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
 * Account control — round avatar trigger that opens the account menu. In
 * the v7 top bar it's a 27px avatar with a light halo on hover.
 */
export function AccountMenu({ collapsed = false, variant = 'sidebar' }: AccountMenuProps) {
  const { user, profile, signOut } = useAuth()
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
            'flex items-center rounded-pill transition-[opacity,box-shadow] duration-200 ease-linear focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            isTopbar
              ? 'size-btn-md justify-center hover:shadow-avatar-hover'
              : collapsed
                ? 'h-btn-md w-btn-md justify-center px-0 hover:opacity-80'
                : 'h-9 w-full gap-2.5 rounded-md px-2 text-left hover:bg-surface-hover',
          )}
        >
          {/* !rounded-pill: the base Avatar's rounded-sm survives twMerge
              (custom token), so force the people-are-round rule here. */}
          <UserAvatar
            src={profile.avatar_url}
            name={profile.username}
            className={cn('shrink-0 !rounded-pill', isTopbar ? 'size-btn-md' : 'h-7 w-7')}
            fallbackClassName={isTopbar ? 'bg-ink text-[9px] font-bold text-white' : undefined}
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
        {featureFlags.leagues && (
          <DropdownMenuItem asChild>
            <Link href="/app/leagues">
              <Icon name="cup" size={14} />
              My leagues
            </Link>
          </DropdownMenuItem>
        )}
        {/* Platform operators only (spec §24.4, Q96): nobody else sees the link,
            and /app/admin answers "page not found" to them anyway. */}
        {profile.is_admin === true && (
          <DropdownMenuItem asChild>
            <Link href="/app/admin" data-account-admin>
              <Icon name="gear" size={14} />
              Admin
            </Link>
          </DropdownMenuItem>
        )}
        {/* No "Style guide" here: /app/styleguide is an internal page,
            reached by its URL only (its own header says so; item #23). */}
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Icon name="setup" size={14} />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PRO_UPSELL_ENABLED && !profile.is_pro && (
          // Off while Pro is on hold (`PRO_UPSELL_ENABLED`, free-only launch).
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
