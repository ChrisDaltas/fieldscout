'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useFollowingIds, useToggleFollow } from '@/hooks/use-follows'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

interface FollowButtonProps {
  /** Profile id to follow. */
  userId: string
  className?: string
  /**
   * `phone`: the FieldScout Mobile pill (handoff m-community D1 — 30px, blue
   * Follow, grey Following, on the m-* tokens so it follows the phone's dark
   * mode). Default: the desktop v7 button.
   */
  look?: 'desktop' | 'phone'
  /** The desktop button's v7 size: `sm` (24px, rows and bylines — the
   *  default) or `md` (27px, beside a profile's name, as v7 draws it). */
  size?: 'sm' | 'md'
}

/** A follow or unfollow that didn't go through: the error toast (an alert
 *  glyph on the ink toast, never a red fill). */
export function toastFollowFailed(wasFollowing: boolean) {
  toast({
    title: wasFollowing ? 'Couldn’t unfollow' : 'Couldn’t follow',
    description: 'Try again in a moment.',
    variant: 'destructive',
  })
}

/**
 * Where a signed-out Follow goes: sign in, then back to the page it was on
 * (`here`) while Community is on — a public profile then hands the visitor
 * into the app, to the profile with Follow (plan C6). While Community is off
 * it is the plain sign-in, as before.
 */
export function signInHref(here: string, communityOn: boolean): string {
  return communityOn ? `/login?redirect=${encodeURIComponent(here)}` : '/login'
}

/**
 * Community follow control (package screen 08). Reads the viewer's follow set
 * from the shared `useFollowingIds` query so every button stays in sync, and
 * toggles optimistically. Renders nothing for the viewer's own row; a
 * signed-out click routes to sign in (`signInHref`). v7 pills: Follow is the
 * blue primary; Following settles to the grey secondary.
 */
export function FollowButton({ userId, className, look = 'desktop', size = 'sm' }: FollowButtonProps) {
  const router = useRouter()
  const { user } = useAuth()
  const { data: following } = useFollowingIds()
  const toggle = useToggleFollow()

  // Never follow yourself — the row shows a "You" chip instead upstream.
  if (user?.id === userId) return null

  const isFollowing = following?.has(userId) ?? false

  const onClick = (e: React.MouseEvent) => {
    // These buttons sit on top of stretched row links.
    e.preventDefault()
    e.stopPropagation()
    if (!user) {
      router.push(signInHref(window.location.pathname + window.location.search, featureFlags.community))
      return
    }
    // The toggle is optimistic and puts the button back if it fails — so a
    // failure says so, rather than silently snapping back (plan C3, F12).
    toggle.mutate({ targetId: userId, isFollowing }, { onError: () => toastFollowFailed(isFollowing) })
  }

  if (look === 'phone') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={toggle.isPending}
        aria-pressed={isFollowing}
        className={cn(
          'flex h-[30px] flex-none items-center rounded-pill px-[14px] text-[12px] font-semibold',
          isFollowing ? 'bg-m-b3s text-m-t2' : 'bg-accent text-white',
          className,
        )}
      >
        {isFollowing ? 'Following' : 'Follow'}
      </button>
    )
  }

  return (
    <Button
      variant={isFollowing ? 'stroke' : 'blue'}
      size={size}
      onClick={onClick}
      disabled={toggle.isPending}
      className={cn(className)}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  )
}
