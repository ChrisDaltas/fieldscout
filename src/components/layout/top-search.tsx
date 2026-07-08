'use client'

import { Icon } from '@/components/ui/icon'
import { useUIStore } from '@/stores/ui-store'

/**
 * Top-bar search trigger — a readonly field that opens the search overlay
 * (the command palette owns all live search: players, lists, users, nav).
 * Same idiom as the sidebar search button, restated for a white surface.
 */
export function TopSearch() {
  const openPalette = useUIStore((s) => s.setCommandPaletteOpen)

  return (
    <button
      type="button"
      onClick={() => openPalette(true)}
      aria-label="Search"
      className="flex h-[34px] w-full min-w-0 cursor-text items-center gap-2 rounded-sm border border-ink bg-white px-2.5 text-left text-[11px] font-semibold text-n-3 transition-colors duration-200 ease-linear hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Icon name="search" size={13} className="shrink-0 text-accent" />
      <span className="truncate">Search players, lists, users…</span>
      <kbd className="ml-auto hidden shrink-0 rounded-sm border border-ink px-1 font-mono text-[9px] font-medium text-n-3 sm:inline">
        ⌘K
      </kbd>
    </button>
  )
}
