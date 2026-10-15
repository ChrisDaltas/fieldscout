'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/**
 * A person's or a league's avatar in Messages: the profile photo when there
 * is one, else the design's initials on a colour (white 600 text). Shape,
 * size and type come from each spot's spec via classes.
 *
 * The design's green "online" dot is not drawn: the app tracks presence only
 * inside the draft room, so there is nothing true to show (a gap, not a
 * decoration to fake).
 */
export function MessagesAvatar({
  text,
  src = null,
  sizeClass,
  radiusClass = 'rounded-full',
  colorClass,
  textClass,
  fgClass = 'text-white',
}: {
  text: string
  src?: string | null
  /** e.g. `size-[52px]` */
  sizeClass: string
  radiusClass?: string
  /** Background class for the initials (from `avatar-colors.ts`). */
  colorClass: string
  /** Initials type, e.g. `text-[16px]`. */
  textClass: string
  fgClass?: string
}) {
  return (
    <Avatar className={cn('flex-none', sizeClass, radiusClass, colorClass)} aria-hidden>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={cn('bg-transparent font-semibold', textClass, fgClass)}>{text}</AvatarFallback>
    </Avatar>
  )
}
