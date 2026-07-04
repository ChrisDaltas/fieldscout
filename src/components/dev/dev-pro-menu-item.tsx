'use client'

import { FlaskConical } from 'lucide-react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

/**
 * DEV ONLY: account-menu item that flips the signed-in account between Free
 * and Pro (via /api/dev/toggle-pro, service-role guarded, 404 in prod).
 * Compiled out of production bundles via build-time NODE_ENV.
 */
export function DevProMenuItem({ isPro }: { isPro: boolean }) {
  if (process.env.NODE_ENV === 'production') return null

  const toggle = async () => {
    const res = await fetch('/api/dev/toggle-pro', { method: 'POST' })
    // Full reload so every cached profile read picks up the new tier.
    if (res.ok) window.location.reload()
  }

  return (
    <DropdownMenuItem onClick={toggle} className="cursor-pointer">
      <FlaskConical className="mr-2 h-4 w-4 text-text-tertiary" />
      Dev: switch to {isPro ? 'Free' : 'Pro'}
    </DropdownMenuItem>
  )
}
