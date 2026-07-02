'use client'

import { Pin } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PinListButtonProps {
  listId: string
  initialPinned: boolean
  signedIn: boolean
}

/**
 * Pin (favorite) another user's public list so it shows up in your "Pinned"
 * lists. Signed-out viewers get a sign-in CTA. Self-contained (plain fetch +
 * local optimistic state) so it works on the public/guest page without a
 * React Query provider.
 */
export function PinListButton({
  listId,
  initialPinned,
  signedIn,
}: PinListButtonProps) {
  const [pinned, setPinned] = useState(initialPinned)
  const [busy, setBusy] = useState(false)

  if (!signedIn) {
    return (
      <Button asChild variant="primary" size="sm" className="shrink-0 font-semibold">
        <Link href="/login">
          <Pin className="h-4 w-4" />
          Pin
        </Link>
      </Button>
    )
  }

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    const next = !pinned
    setPinned(next) // optimistic
    try {
      const res = await fetch(`/api/lists/${listId}/favorite`, { method: 'POST' })
      if (!res.ok) throw new Error('Request failed')
      const body = (await res.json()) as { is_favorited?: boolean }
      if (typeof body.is_favorited === 'boolean') setPinned(body.is_favorited)
    } catch {
      setPinned(!next) // rollback
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      onClick={toggle}
      disabled={busy}
      variant={pinned ? 'default' : 'primary'}
      size="sm"
      className="shrink-0 font-semibold"
    >
      <Pin className={cn('h-4 w-4', pinned && 'fill-current')} />
      {pinned ? 'Pinned' : 'Pin'}
    </Button>
  )
}
