'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AppDndContext } from '@/components/layout/app-dnd-context'
import { AppHeader } from '@/components/layout/app-header'
import { BottomTabs } from '@/components/layout/bottom-tabs'
import { DraftBar } from '@/components/layout/draft-bar'
import { MoreSheet } from '@/components/layout/more-sheet'
import { ResearchRail } from '@/components/layout/rail/research-rail'
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

/** Field Scout shell — ink sidebar · content column (draft bar + sticky
 *  header + scrolling main) · right rail. Desktop-first; mobile keeps the
 *  legacy top bar + bottom tabs until the mobile companion pass. */
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
      <div className="flex h-screen flex-col overflow-hidden bg-page">
        {/* Mobile-only legacy top bar; desktop nav lives in the sidebar/rail */}
        <div className="lg:hidden">
          <TopNav variant="app" />
        </div>

        {/* The rail strip is fixed-right (45px); clear it on desktop. */}
        <div className="flex min-h-0 flex-1 lg:pr-rail-strip">
          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <DraftBar />
            <div className="hidden lg:block">
              <AppHeader />
            </div>
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div
                className={cn(
                  'w-full px-4 py-5 pb-20 lg:px-7 lg:pb-[20vh]',
                  !fullBleed && 'mx-auto max-w-content',
                )}
              >
                {children}
              </div>
            </main>
          </div>

          <ResearchRail />
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
