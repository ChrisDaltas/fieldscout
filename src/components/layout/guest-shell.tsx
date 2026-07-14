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

/** Guest chrome — white top bar, lime signup banner, page-grey content. */
export function GuestShell({
  children,
  showBanner = true,
  wide = false,
}: GuestShellProps) {
  const { user } = useAuth()
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <TopNav variant="guest" />
      {showBanner && !user && <GuestBanner />}
      <main className="flex-1">
        <div
          className={cn(
            'mx-auto w-full px-4 py-5 lg:px-7',
            wide ? 'max-w-screen-2xl' : 'max-w-content',
          )}
        >
          {children}
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
