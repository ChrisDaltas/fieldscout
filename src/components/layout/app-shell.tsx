'use client'

import { usePathname } from 'next/navigation'

import { AppDndContext } from '@/components/layout/app-dnd-context'
import { AppHeader } from '@/components/layout/app-header'
import { DraftBar } from '@/components/layout/draft-bar'
import { LayoutModeFrame } from '@/components/layout/layout-mode-frame'
import { ResearchRail, useActiveRailTool } from '@/components/layout/rail/research-rail'
import { Sidebar } from '@/components/layout/sidebar'
import { TopNav } from '@/components/layout/top-nav'
import { ListFormDialog } from '@/components/lists/list-form-dialog'
import { MobileDock, useMobileDock } from '@/components/mobile/shell/mobile-dock'
import { ListWindowsHost } from '@/components/lists/v2/list-windows-host'
import { CommandPalette } from '@/components/shared/command-palette'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface AppShellProps {
  children: React.ReactNode
}

// Routes that render edge-to-edge (no gutter). The players spreadsheet is a
// bordered card that wants the standard gutter like every other page — its
// horizontal scroll happens inside the card, so it doesn't need full bleed.
const FULL_BLEED_ROUTES: ReadonlySet<string> = new Set<string>()
const FULL_BLEED_PREFIXES: readonly string[] = ['/app/lists/']

/** v7 shell — the 48px top bar across the whole app, then a row of: left
 *  rail · content column (draft bar + page title band + scrolling main) ·
 *  right-side bar. The mobile layout drops the top bar, rails and page title
 *  band for the FieldScout Mobile bottom dock. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const createListOpen = useUIStore((s) => s.isCreateListOpen)
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)
  const createListSeedPlayerId = useUIStore((s) => s.createListSeedPlayerId)
  const setCreateListSeedPlayerId = useUIStore(
    (s) => s.setCreateListSeedPlayerId,
  )

  const railTool = useActiveRailTool()
  // Mobile (FieldScout Mobile handoff): the bottom dock replaces the top
  // bar, sidebar and right-side bar; content clears the dock by its height.
  const dock = useMobileDock()

  const fullBleed =
    FULL_BLEED_ROUTES.has(pathname) ||
    FULL_BLEED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  return (
    <AppDndContext>
      <LayoutModeFrame className="flex flex-col bg-page mob:bg-m-b0">
        <div className="contents mob:hidden">
          <TopNav variant="app" />
        </div>

        {/* The right-side bar sits at this row's right edge; clear it on
            desktop — and the open panel too, so it never covers the page
            (D483). `relative` anchors it inside the min-width frame, so a
            narrow window covers it like the rest of the app. */}
        <div className={cn('relative flex min-h-0 flex-1', railTool ? 'desk:pr-rail-open' : 'desk:pr-rail-strip')}>
          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <DraftBar />
            <div className="hidden desk:block">
              <AppHeader />
            </div>
            <main
              className="min-h-0 flex-1 overflow-y-auto"
              style={{ '--m-dockpad': `${dock.clearance}px` } as React.CSSProperties}
            >
              {/* Content fills the full width between the sidebar and rail
                  (matching the prototype's padded, un-capped main). Full-bleed
                  routes drop the horizontal padding for edge-to-edge tables. */}
              <div
                className={cn(
                  'w-full py-5 pb-20 lg:pb-[20vh] mob:pb-[var(--m-dockpad)]',
                  !fullBleed && 'px-4 lg:px-7',
                  // Mobile screens own their gutters (MobileScreen undoes
                  // this one); unconverted pages keep a 16px gutter.
                  'mob:px-4',
                )}
              >
                {children}
              </div>
            </main>
          </div>

          <ResearchRail />
        </div>

        <div className="hidden mob:block">
          <MobileDock />
        </div>
        {/* Lists v2 pop-outs (LV.15, D13). Hosted here rather than on the Lists
            page so they survive navigation, and **renders nothing at all** when
            no window is open — this is the one Round 2 component that mounts on
            every route. */}
        <ListWindowsHost />
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
      </LayoutModeFrame>
    </AppDndContext>
  )
}
