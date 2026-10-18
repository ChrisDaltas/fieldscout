import { create } from 'zustand'

import type { PoolPlayer } from '@/components/draft/available-players-ops'

/**
 * F570 — the bridge between the app-level drag (the rail's player rows, in
 * `AppDndContext`) and the My Team lineup, which runs its own nested
 * `DndContext` (its droppables cannot see an app-level drag). The rail row
 * says what it carries; the app context publishes the drag and the target
 * under the pointer (`[data-rail-drop]`, read with `elementFromPoint`); the
 * lineup editor marks the targets that ACCEPT this player (prevent, don't
 * refuse) and registers the handler the drop calls. Client UI state only.
 */
export interface RailDrag {
  leagueId: string
  playerId: string
  /** `free_agent` = on no team in this league; `rostered` = on `teamId`. */
  availability: 'free_agent' | 'rostered'
  teamId: string | null
  player: PoolPlayer
}

interface RailLineupDragStore {
  drag: RailDrag | null
  /** The `data-rail-drop` id under the pointer, or null. */
  hover: string | null
  /** The mounted lineup's drop handler; it accepts only its own targets. */
  onDrop: ((drag: RailDrag, target: string) => void) | null
  start: (drag: RailDrag) => void
  setHover: (target: string | null) => void
  end: () => void
  register: (handler: ((drag: RailDrag, target: string) => void) | null) => void
}

export const useRailLineupDragStore = create<RailLineupDragStore>()((set) => ({
  drag: null,
  hover: null,
  onDrop: null,
  start: (drag) => set({ drag, hover: null }),
  setHover: (hover) => set((s) => (s.hover === hover ? s : { hover })),
  end: () => set({ drag: null, hover: null }),
  register: (onDrop) => set({ onDrop }),
}))

/** The drop target id under a point — the nearest `[data-rail-drop]`. */
export function railDropTargetAt(x: number, y: number): string | null {
  if (typeof document === 'undefined') return null
  const el = document.elementFromPoint(x, y)
  const hit = el?.closest('[data-rail-drop]')
  return hit?.getAttribute('data-rail-drop') ?? null
}
