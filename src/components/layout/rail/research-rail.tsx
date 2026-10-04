'use client'

import { useEffect, useState } from 'react'

import { AccountMenu } from '@/components/layout/account-menu'
import { MessagesPanel, dmUnreadCount } from '@/components/layout/rail/messages-panel'
import { NotificationsPanel } from '@/components/layout/rail/notifications-panel'
import { PlayersPanel } from '@/components/layout/rail/players-panel'
import { TeamsPanel } from '@/components/layout/rail/teams-panel'
import { Icon, type IconName } from '@/components/ui/icon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useNotifications } from '@/hooks/use-notifications'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useRailStore, type RailTool } from '@/stores/rail-store'

// Messages and Teams (league teams) are release-gated with their features.
const TOOLS: ReadonlyArray<{ id: RailTool; icon: IconName; label: string }> = [
  { id: 'notifications', icon: 'notification', label: 'Notifications' },
  ...(featureFlags.messages
    ? [{ id: 'messages', icon: 'comments', label: 'Messages' } as const]
    : []),
  ...(featureFlags.leagues ? [{ id: 'teams', icon: 'team', label: 'Teams' } as const] : []),
  { id: 'players', icon: 'profile', label: 'Players' },
]

/**
 * Research rail — the fixed right-hand tool strip + slide-out panel,
 * available on every desktop screen (hidden below `lg:`). The 45px ink strip
 * carries the account control and the four tool buttons; clicking a tool
 * slides a 256px white panel out to the left of the strip. The open tool
 * persists across navigation via the rail store (localStorage).
 *
 * Mount once inside the app shell, INSIDE `AppDndContext`, so player rows in
 * the Players tool can drag onto sidebar lists / tier zones. Desktop content
 * needs `lg:pr-rail-strip` (or equivalent) on the shell so the strip never
 * overlaps it.
 */
/**
 * The open tool, or null — after mount only (the store hydrates from
 * localStorage on the client), and a persisted tool that is now gated off
 * reads as closed. The shell pads by it so the panel never covers the page
 * (D483).
 */
export function useActiveRailTool(): RailTool | null {
  const openTool = useRailStore((s) => s.openTool)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted && openTool && TOOLS.some((t) => t.id === openTool) ? openTool : null
}

export function ResearchRail() {
  const openTool = useRailStore((s) => s.openTool)
  const toggleTool = useRailStore((s) => s.toggleTool)
  const closeRail = useRailStore((s) => s.closeRail)

  // The store hydrates from localStorage on the client only — render the
  // persisted panel state after mount so SSR and first client paint agree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // A persisted openTool may point at a gated-off tool — treat it as closed.
  const activeTool = mounted && openTool && TOOLS.some((t) => t.id === openTool) ? openTool : null

  // Unseen counts for the strip badges. Notifications are real (shared query
  // with the rest of the app); messages have no backend yet, so the count is
  // 0 until real DM threads exist.
  const { data: notificationsData } = useNotifications(mounted)
  const unseen: Partial<Record<RailTool, number>> = {
    notifications: notificationsData?.unreadCount ?? 0,
    ...(featureFlags.messages ? { messages: dmUnreadCount() } : {}),
  }

  // Prototype: the mouse wheel anywhere over the rail scrolls the open list.
  // A wheel already over the list scrolls it natively — leave that alone.
  const onWheel = (e: React.WheelEvent) => {
    const list = document.querySelector<HTMLElement>('[data-rail-scroll]')
    if (!list || list.contains(e.target as Node)) return
    list.scrollBy({ top: e.deltaY })
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* Icon strip — ink, full height, above the panel. Pinned over the
          scrolling page (an overlay per CLAUDE.md's elevation rule), so its
          resting border stays. */}
      <div
        onWheel={onWheel}
        className="fixed inset-y-0 right-0 z-40 hidden w-rail-strip flex-col items-center border-l border-ink bg-ink lg:flex"
        role="toolbar"
        aria-label="Research rail"
        aria-orientation="vertical"
      >
        {/* Account zone — the logo band's height. Prototype: it turns white
            while a panel is open (the panel's head continues across it). */}
        <div
          className={cn(
            'flex h-chrome-band w-full shrink-0 items-center justify-center border-b transition-colors duration-200 ease-linear',
            activeTool ? 'border-ink bg-white' : 'border-on-ink-rule',
          )}
          data-rail-account={activeTool ? 'open' : 'closed'}
        >
          <AccountMenu variant="topbar" />
        </div>

        <div className="flex flex-col items-center gap-1.5 pt-2.5">
          {TOOLS.map((tool) => {
            const isActive = activeTool === tool.id
            const count = unseen[tool.id] ?? 0
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={tool.label}
                    aria-pressed={isActive}
                    data-rail-tool={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    className={cn(
                      'relative flex h-nav-tile w-nav-tile items-center justify-center rounded-sm transition-colors duration-200 ease-linear',
                      isActive
                        ? 'bg-white text-ink'
                        : 'text-on-ink hover:bg-on-ink-wash hover:text-white',
                    )}
                  >
                    <Icon name={tool.icon} size={16} />
                    {count > 0 && (
                      <span className="fs-num absolute -right-1 -top-1 inline-flex h-count-chip min-w-count-chip items-center justify-center rounded-pill bg-brand px-1 text-[9px] font-bold leading-none text-ink">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{tool.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>

      {/* Tool panel — white, slides out left of the strip, persists across
          navigation. Mounts/unmounts with the open tool; 200ms linear only. */}
      {activeTool && (
        <aside
          onWheel={onWheel}
          className="fixed inset-y-0 right-rail-strip z-30 hidden w-rail-panel flex-col border-l border-ink bg-white duration-200 ease-linear animate-in fade-in-0 slide-in-from-right-4 lg:flex"
          aria-label={`${TOOLS.find((t) => t.id === activeTool)?.label} panel`}
        >
          {activeTool === 'notifications' && <NotificationsPanel onClose={closeRail} />}
          {activeTool === 'messages' && <MessagesPanel onClose={closeRail} />}
          {activeTool === 'teams' && <TeamsPanel onClose={closeRail} />}
          {activeTool === 'players' && <PlayersPanel onClose={closeRail} />}
        </aside>
      )}
    </TooltipProvider>
  )
}
