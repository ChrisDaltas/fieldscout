'use client'

import * as React from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/** People are round; team & league crests are square tiles with an ink stroke. */
type UserAvatarKind = 'user' | 'team' | 'league'

interface UserAvatarProps {
  src?: string | null
  alt?: string
  /** Used to compute initials when no src is supplied. */
  name?: string | null
  /** Optional explicit initials override (e.g. a crest's own lettering). */
  initials?: string
  /**
   * Shape per the design system: `user` (default) renders a borderless round
   * pill; `team` / `league` render the square crest with a 1px ink border.
   */
  kind?: UserAvatarKind
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
 * Identity avatar. The base `Avatar` is the square ink-stroked tile (player
 * headshots / crests); this wrapper applies the design-system shape rule —
 * people are the only round element in the UI, crests stay square. Fallback
 * is bold ink initials on the n-4 sunken fill (from the base component).
 */
export const UserAvatar = React.forwardRef<
  React.ElementRef<typeof Avatar>,
  UserAvatarProps
>(({ src, alt, name, initials, kind = 'user', className, fallbackClassName }, ref) => {
  const computed = initials ?? computeInitials(name ?? alt ?? null)

  return (
    <Avatar
      ref={ref}
      className={cn(
        kind === 'user'
          ? 'rounded-pill border-0'
          : 'rounded-sm border border-ink',
        className,
      )}
    >
      <AvatarImage src={src ?? undefined} alt={alt ?? name ?? ''} />
      <AvatarFallback className={cn('text-[10px]', fallbackClassName)}>
        {computed}
      </AvatarFallback>
    </Avatar>
  )
})
UserAvatar.displayName = 'UserAvatar'
