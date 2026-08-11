'use client'

import * as React from 'react'

import { AvatarImage } from '@/components/ui/avatar'
import { getPlayerImageUrl, isTeamDefense, type PlayerImageSubject } from '@/lib/player-image'
import { cn } from '@/lib/utils'

/**
 * The player picture, everywhere.
 *
 * A thin composition over the existing {@link AvatarImage} primitive — not a
 * second avatar component. It exists to hold the two things every call site was
 * repeating (and getting wrong) in its own way:
 *
 * 1. **Which URL.** `getPlayerImageUrl` swaps a team defense's non-existent
 *    headshot for its team logo (see `src/lib/player-image.ts` for the ruling
 *    and the measured 403). Call sites never branch on position.
 *
 * 2. **How it fits.** A headshot is a crop — `object-cover object-top` keeps
 *    the face when the box is not the photo's aspect ratio. A team logo is a
 *    whole mark on transparency, so cropping it is always wrong; it gets
 *    `object-contain`, which matters most in the non-square boxes
 *    (`player-card.tsx`'s hero tile is 93px tall and 60% wide).
 *    These class names live here rather than in `src/lib/**` because only
 *    `src/{app,components,pages}` are in Tailwind's `content` globs.
 *
 * **The fallback comes for free, and that is the point.** Radix's `Avatar.Image`
 * reports `error` both when `src` is absent *and* when the load fails, and
 * `Avatar.Fallback` renders whenever the status is not `loaded`. The pattern
 * this replaces — `{player.headshot_url && <AvatarImage …/>}` — only handled
 * the absent case, so a 403 (which is exactly what every DEF row produced)
 * painted the browser's broken-image glyph instead of the initials. Rendering
 * this component unconditionally hands both cases to the primitive.
 * CLAUDE.md: never let "nothing happened" mean "it worked".
 */
export function PlayerAvatarImage({
  player,
  alt = '',
  className,
  ...props
}: {
  player: PlayerImageSubject
  alt?: string
} & Omit<React.ComponentPropsWithoutRef<typeof AvatarImage>, 'src' | 'alt'>) {
  const src = getPlayerImageUrl(player)
  // A logo only wants `object-contain` when a logo is actually what resolved;
  // a DEF row with an unrecognised abbreviation resolves to null and falls
  // through to the initials, where the fit class is irrelevant either way.
  const isLogo = src !== null && isTeamDefense(player)

  return (
    <AvatarImage
      // `undefined` rather than `null`: Radix treats a falsy src as `error`,
      // which is the branch that shows the fallback.
      src={src ?? undefined}
      alt={alt}
      className={cn(
        'h-full w-full',
        isLogo ? 'object-contain object-center p-[1px]' : 'object-cover object-top',
        className,
      )}
      {...props}
    />
  )
}
