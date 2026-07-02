'use client'

import { GuestBanner } from '@/components/layout/guest-banner'
import { TopNav } from '@/components/layout/top-nav'
import { CommandPalette } from '@/components/shared/command-palette'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

interface GuestShellProps {
  children: React.ReactNode
  showBanner?: boolean
  /**
   * When true, the content container expands toward full width — used by the
   * guest home page so the 12-column Big Board grid actually has room.
   */
  wide?: boolean
}

export function GuestShell({
  children,
  showBanner = true,
  wide = false,
}: GuestShellProps) {
  const { user } = useAuth()
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav variant="guest" />
      {showBanner && !user && <GuestBanner />}
      <main className="flex-1">
        <div
          className={cn(
            'mx-auto w-full px-4 py-6 lg:px-6',
            wide ? 'max-w-screen-2xl' : 'max-w-7xl',
          )}
        >
          {children}
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
