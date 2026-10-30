'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useToggleFavorite } from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'

interface PinListButtonProps {
  listId: string
  initialPinned: boolean
  signedIn: boolean
}

/**
 * Pin (favorite) another user's public list so it shows up in your "Pinned"
 * lists — on the public share page and on Community's list page in the app
 * (plan C5). Signed-out viewers get a sign-in CTA.
 *
 * Optimistic on its own state (the share page has no list cache to flip), and
 * through the shared `useToggleFavorite`, so your Lists' Pinned section and
 * the list's own read follow at once. A pin that doesn't go through puts the
 * button back and says so — never a silent snap-back.
 */
export function PinListButton({
  listId,
  initialPinned,
  signedIn,
}: PinListButtonProps) {
  const [pinned, setPinned] = useState(initialPinned)
  const toggle = useToggleFavorite()

  if (!signedIn) {
    return (
      <Button asChild variant="blue" size="sm" className="shrink-0">
        <Link href="/login">
          <Icon name="marker" size={13} />
          Pin
        </Link>
      </Button>
    )
  }

  const onClick = () => {
    // One toggle at a time: the server flips whatever it holds.
    if (toggle.isPending) return
    const next = !pinned
    setPinned(next) // optimistic
    toggle.mutate(listId, {
      onSuccess: (body) => setPinned(body.is_favorited),
      onError: () => {
        setPinned(!next) // rollback
        toast({
          title: next ? 'Couldn’t pin this list' : 'Couldn’t unpin this list',
          description: 'Try again in a moment.',
          variant: 'destructive',
        })
      },
    })
  }

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={toggle.isPending}
      aria-pressed={pinned}
      variant={pinned ? 'stroke' : 'blue'}
      size="sm"
      className="shrink-0"
    >
      <Icon name="marker" size={13} />
      {pinned ? 'Pinned' : 'Pin'}
    </Button>
  )
}
