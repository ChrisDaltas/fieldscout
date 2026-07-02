'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AppDndContext } from '@/components/layout/app-dnd-context'
import { BottomTabs } from '@/components/layout/bottom-tabs'
import { MoreSheet } from '@/components/layout/more-sheet'
import { Sidebar } from '@/components/layout/sidebar'
import { TopNav } from '@/components/layout/top-nav'
import { ListFormDialog } from '@/components/lists/list-form-dialog'
import { CommandPalette } from '@/components/shared/command-palette'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface AppShellProps {
  children: React.ReactNode
}

// Routes that need to render edge-to-edge inside the main panel.
// Anything else gets the standard centered/max-width container.
const FULL_BLEED_ROUTES: ReadonlySet<string> = new Set(['/app/players'])
const FULL_BLEED_PREFIXES: readonly string[] = ['/app/lists/']

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const createListOpen = useUIStore((s) => s.isCreateListOpen)
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)
  const createListSeedPlayerId = useUIStore((s) => s.createListSeedPlayerId)
  const setCreateListSeedPlayerId = useUIStore(
    (s) => s.setCreateListSeedPlayerId,
  )

  // Close the More sheet on route change
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const fullBleed =
    FULL_BLEED_ROUTES.has(pathname) ||
    FULL_BLEED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  return (
    <AppDndContext>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav variant="app" />

        <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 lg:pb-2">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-bg-elevated">
            <div className="flex-1 overflow-y-auto pb-20 lg:pb-0">
              <div
                className={cn(
                  'w-full px-4 py-6 lg:px-6',
                  !fullBleed && 'mx-auto max-w-7xl',
                )}
              >
                {children}
              </div>
            </div>
          </main>
        </div>

        <BottomTabs onMoreClick={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
        <CommandPalette />
        <ListFormDialog
          open={createListOpen}
          onOpenChange={(open) => {
            setCreateListOpen(open)
            if (!open) setCreateListSeedPlayerId(null)
          }}
          mode="create"
          seedPlayerId={createListSeedPlayerId}
        />
      </div>
    </AppDndContext>
  )
}
