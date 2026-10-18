'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useFollowingIds, useToggleFollow } from '@/hooks/use-follows'
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
}

/**
 * Community follow control (package screen 08). Reads the viewer's follow set
 * from the shared `useFollowingIds` query so every button stays in sync, and
 * toggles optimistically. Renders nothing for the viewer's own row; a
 * signed-out click routes to login. v7 pills: Follow is the blue primary;
 * Following settles to the grey secondary.
 */
export function FollowButton({ userId, className, look = 'desktop' }: FollowButtonProps) {
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
      router.push('/login')
      return
    }
    toggle.mutate({ targetId: userId, isFollowing })
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
      size="sm"
      onClick={onClick}
      disabled={toggle.isPending}
      className={cn(className)}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  )
}
