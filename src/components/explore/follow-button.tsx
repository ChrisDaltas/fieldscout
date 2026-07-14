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
}

/**
 * Community follow control (package screen 08). Reads the viewer's follow set
 * from the shared `useFollowingIds` query so every button stays in sync, and
 * toggles optimistically. Renders nothing for the viewer's own row; a
 * signed-out click routes to login. Following inverts stroke → solid ink.
 */
export function FollowButton({ userId, className }: FollowButtonProps) {
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

  return (
    <Button
      variant={isFollowing ? 'dark' : 'stroke'}
      size="sm"
      onClick={onClick}
      disabled={toggle.isPending}
      className={cn(className)}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  )
}
