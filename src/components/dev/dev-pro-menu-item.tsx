'use client'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'

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
      <Icon name="repeat" size={14} className="text-n-3" />
      Dev: switch to {isPro ? 'Free' : 'Pro'}
    </DropdownMenuItem>
  )
}
