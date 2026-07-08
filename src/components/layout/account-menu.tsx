'use client'

import Link from 'next/link'
import {
  Crown,
  KeyRound,
  LogOut,
  Settings,
  User as UserIcon,
} from 'lucide-react'

import { DevProMenuItem } from '@/components/dev/dev-pro-menu-item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

interface AccountMenuProps {
  collapsed?: boolean
  /**
   * `sidebar` (default) renders the existing avatar + name + username row.
   * `topbar` renders an avatar-only compact button suited for the top nav.
   */
  variant?: 'sidebar' | 'topbar'
}

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
                'flex h-10 items-center gap-3 rounded-full px-3 text-sm text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground',
                isCompact && 'w-10 justify-center px-0',
              )}
            >
              <UserIcon className="h-5 w-5" />
              {!isCompact && <span>Account</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side={isTopbar ? 'bottom' : 'top'} sideOffset={8} className="w-64">
            <DropdownMenuLabel className="font-normal text-text-secondary">
              Your session looks stale — log out and back in to fix it.
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={signOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
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
          'flex h-10 items-center gap-3 rounded-full px-3 text-sm text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground',
          isCompact && 'w-10 justify-center px-0',
        )}
        title={isCompact ? 'Sign in' : undefined}
      >
        <UserIcon className="h-5 w-5" />
        {!isCompact && <span>Sign in</span>}
      </Link>
    )
  }

  const displayName = profile.display_name ?? `@${profile.username}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          title={isCompact ? displayName : undefined}
          className={cn(
            'flex items-center rounded-full transition-colors hover:bg-bg-elevated-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bg-elevated-3',
            isTopbar
              ? 'h-9 w-9 justify-center'
              : collapsed
                ? 'h-10 w-10 justify-center px-0'
                : 'h-10 w-full gap-3 px-2 text-left',
          )}
        >
          <UserAvatar
            src={profile.avatar_url}
            name={profile.display_name ?? profile.username}
            className={cn(isTopbar ? 'h-8 w-8 shrink-0' : 'h-7 w-7 shrink-0')}
          />
          {!isCompact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {displayName}
              </p>
              <p className="truncate text-[10px] text-text-tertiary">
                @{profile.username}
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
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium leading-none">{displayName}</p>
          <p className="mt-1 text-[10px] leading-none text-text-tertiary">
            @{profile.username}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/u/${profile.username}`}>
            <UserIcon className="mr-2 h-4 w-4" />
            View public profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings#password">
            <KeyRound className="mr-2 h-4 w-4" />
            Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {!profile.is_pro && (
          <DropdownMenuItem asChild>
            <Link href="/app/settings/billing">
              <Crown className="mr-2 h-4 w-4 text-amber-300" />
              Upgrade to Pro
            </Link>
          </DropdownMenuItem>
        )}
        <DevProMenuItem isPro={Boolean(profile.is_pro)} />
        <DropdownMenuItem
          onClick={signOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
