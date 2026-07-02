import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { PlayerListContext } from '@/components/players/player-detail-actions'

export interface PlayerWindowState {
  playerId: string
  listContext: PlayerListContext | null
  readOnly: boolean
}

export interface WindowPosition {
  x: number
  y: number
}

interface OpenOptions {
  listContext?: PlayerListContext | null
  readOnly?: boolean
}

interface PlayerWindowsStore {
  /** Open player windows, ordered back-to-front (last = focused/top). */
  windows: PlayerWindowState[]
  /** Last-known position per player, remembered across close/re-open + reloads. */
  positions: Record<string, WindowPosition>
  open: (playerId: string, opts?: OpenOptions) => void
  close: (playerId: string) => void
  focus: (playerId: string) => void
  setPosition: (playerId: string, pos: WindowPosition) => void
  closeAll: () => void
}

/**
 * Global manager for the floating player detail windows. Unlike a modal, many
 * can be open at once; they're keyed by playerId (one window per player), and
 * the array order is the z-stack — opening or focusing a player moves it to the
 * end (front).
 *
 * `positions` is persisted (not `windows`): reloading doesn't reopen windows,
 * but re-opening a player restores wherever you last dragged its window.
 */
export const usePlayerWindowsStore = create<PlayerWindowsStore>()(
  persist(
    (set) => ({
      windows: [],
      positions: {},
      open: (playerId, opts) =>
        set((state) => {
          const entry: PlayerWindowState = {
            playerId,
            listContext: opts?.listContext ?? null,
            readOnly: opts?.readOnly ?? false,
          }
          // Re-opening an already-open player refreshes its context and brings
          // it to the front rather than spawning a duplicate.
          const rest = state.windows.filter((w) => w.playerId !== playerId)
          return { windows: [...rest, entry] }
        }),
      close: (playerId) =>
        set((state) => ({
          windows: state.windows.filter((w) => w.playerId !== playerId),
        })),
      focus: (playerId) =>
        set((state) => {
          const top = state.windows[state.windows.length - 1]
          if (!top || top.playerId === playerId) return state
          const win = state.windows.find((w) => w.playerId === playerId)
          if (!win) return state
          return {
            windows: [
              ...state.windows.filter((w) => w.playerId !== playerId),
              win,
            ],
          }
        }),
      setPosition: (playerId, pos) =>
        set((state) => ({
          positions: { ...state.positions, [playerId]: pos },
        })),
      closeAll: () => set({ windows: [] }),
    }),
    {
      name: 'fieldscout.player-windows',
      // Persist only remembered positions — open windows should not survive a
      // reload, but their last spot should.
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
)
