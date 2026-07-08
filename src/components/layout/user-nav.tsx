'use client'

import Link from 'next/link'

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
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'

export function UserNav() {
  const { user, profile, isLoading, signOut } = useAuth()

  if (isLoading) {
    return <Skeleton className="h-7 w-7 rounded-pill" />
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button variant="blue" size="sm" asChild>
          <Link href="/signup">Sign up</Link>
        </Button>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="flex h-btn-md w-btn-md items-center justify-center rounded-sm transition-opacity duration-200 ease-linear hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {/* !rounded-pill: the base Avatar's rounded-sm survives twMerge
              (custom token), so force the people-are-round rule here. */}
          <UserAvatar
            src={profile?.avatar_url}
            name={profile?.display_name ?? profile?.username}
            className="h-7 w-7 !rounded-pill"
            fallbackClassName="text-[10px]"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel>
          <p className="text-[13px] font-bold leading-tight text-ink">
            {profile?.display_name ?? profile?.username}
          </p>
          <p className="mt-0.5 text-[11px] font-medium leading-tight text-n-3">
            @{profile?.username}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/profile/${profile?.username}`}>
            <Icon name="profile" size={14} />
            My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Icon name="setup" size={14} />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
