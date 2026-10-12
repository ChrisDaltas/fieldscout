'use client'

import { Icon } from '@/components/ui/icon'
import { useUIStore } from '@/stores/ui-store'

/**
 * Top-bar search trigger — v7 `FSSearch7` look: a 27px grey pill that
 * darkens on hover, with the ⌘K key on white. It opens the search overlay
 * (the command palette owns all live search: players, lists, users, nav).
 */
export function TopSearch() {
  const openPalette = useUIStore((s) => s.setCommandPaletteOpen)

  return (
    <button
      type="button"
      onClick={() => openPalette(true)}
      aria-label="Search"
      className="flex h-btn-md w-full min-w-0 cursor-text items-center gap-[7px] rounded-pill bg-surface-control pl-2.5 pr-[5px] text-left text-[11px] font-medium text-n-6 transition-colors hover:bg-n-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Icon name="search" size={12} className="shrink-0" />
      <span className="truncate">Search</span>
      <kbd className="ml-auto hidden h-[17px] shrink-0 items-center rounded-sm bg-white px-[5px] text-[9px] font-semibold text-n-3 sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  )
}
