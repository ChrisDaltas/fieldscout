'use client'

import { Icon } from '@/components/ui/icon'
import { useLayoutMode } from '@/hooks/use-layout-mode'
import { cn } from '@/lib/utils'

/**
 * The full-height frame every logged-in layout sits in (app shell, draft
 * room). It runs the layout-mode hook and, in desktop mode, holds the app at
 * its 1024px minimum: a narrower window scrolls sideways and covers the right
 * of the app rather than the layout degrading (Chris, 2026-10-13). In a very
 * narrow desktop window a prompt offers the mobile layout.
 */
export function LayoutModeFrame({
  className,
  children,
}: {
  /** Classes for the inner, min-width column (flex direction, background…). */
  className?: string
  children: React.ReactNode
}) {
  const { showMobilePrompt, switchToMobile } = useLayoutMode()

  return (
    <div className="h-screen overflow-hidden desk:overflow-x-auto" data-layout-frame>
      <div className={cn('h-full desk:min-w-app', className)}>{children}</div>
      {showMobilePrompt && (
        // A true overlay pinned to the window (not the scrolled app), so it
        // carries a resting shadow — CLAUDE.md → "Elevation". A system
        // message, so a rounded rectangle, never pill-ended (its button stays
        // a pill) — CLAUDE.md → "Bright red is ink, never paint".
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-message bg-ink py-1.5 pl-4 pr-1.5 text-[11px] font-semibold text-white shadow-hard-8"
          data-mobile-layout-prompt
        >
          <span className="text-white/70">Window too narrow</span>
          <button
            type="button"
            onClick={switchToMobile}
            className="inline-flex h-btn-sm items-center gap-1.5 rounded-pill bg-white px-2.5 text-[10px] font-semibold text-ink transition-colors hover:bg-surface-pressed"
          >
            <Icon name="mobile" size={11} />
            Switch to mobile layout
          </button>
        </div>
      )}
    </div>
  )
}
