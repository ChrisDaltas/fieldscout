'use client'

import * as React from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  src?: string | null
  alt?: string
  /** Used to compute initials when no src is supplied. */
  name?: string | null
  /** Optional explicit initials override (e.g. for @username vs display_name). */
  initials?: string
  className?: string
  fallbackClassName?: string
}

function computeInitials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

/**
 * Circular avatar for users. The base `Avatar` component is `rounded-md`
 * (used for player headshots so they don't look like users); this wrapper
 * forces `rounded-full` on both the container and the fallback so every
 * place a user appears in the UI gets a consistent circular treatment.
 */
export const UserAvatar = React.forwardRef<
  React.ElementRef<typeof Avatar>,
  UserAvatarProps
>(({ src, alt, name, initials, className, fallbackClassName }, ref) => {
  const computed = initials ?? computeInitials(name ?? alt ?? null)

  return (
    <Avatar ref={ref} className={cn('rounded-full', className)}>
      <AvatarImage
        src={src ?? undefined}
        alt={alt ?? name ?? ''}
        className="rounded-full"
      />
      <AvatarFallback
        className={cn('rounded-full text-[10px] font-semibold', fallbackClassName)}
      >
        {computed}
      </AvatarFallback>
    </Avatar>
  )
})
UserAvatar.displayName = 'UserAvatar'
