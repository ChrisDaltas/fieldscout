'use client'

import { WithOnlineDot, type OnlineDotSize } from '@/components/mobile/ui/online-dot'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/**
 * A person's or a league's avatar (Messages, and the league tiles on Home and
 * in the switcher): the photo when there is one, else the design's initials
 * on a colour (white 600 text). Shape, size and type come from each spot's
 * spec via classes. A new photo — or none — starts the tile afresh: Radix
 * remembers a loaded image, so a tile that swaps a league with a photo for
 * one without (the switcher's swipe) would otherwise draw neither.
 *
 * A person's avatar takes the design's green "online" dot (gap list §3 #25)
 * when `online` is passed — real presence from your current league's room
 * (`useIsOnline`), never decoration. A league's tile never has one.
 */
export function MessagesAvatar({
  text,
  src = null,
  sizeClass,
  radiusClass = 'rounded-full',
  colorClass,
  textClass,
  fgClass = 'text-white',
  online,
  onlineSize = 'lg',
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
  /** Presence applies here (a person): true draws the green dot. Leave it
   *  out where presence doesn't apply (a league's tile). */
  online?: boolean
  /** The dot's size for this avatar (`OnlineDotSize`; 52px → lg). */
  onlineSize?: OnlineDotSize
}) {
  const avatar = (
    <Avatar key={src ?? ''} className={cn('flex-none', sizeClass, radiusClass, colorClass)} aria-hidden>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={cn('bg-transparent font-semibold', textClass, fgClass)}>{text}</AvatarFallback>
    </Avatar>
  )
  if (online === undefined) return avatar
  return (
    <WithOnlineDot online={online} size={onlineSize}>
      {avatar}
    </WithOnlineDot>
  )
}
