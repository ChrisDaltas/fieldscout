import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { GLOBAL_CARD_CONTEXT, type PlayerCardContext } from '@/components/players/player-card-context'

export interface PlayerWindowState {
  playerId: string
  readOnly: boolean
  /** Where the card was opened from — decides its actions block (a league's
   *  add / drop / trade, the draft's Queue, or every league at once). */
  context: PlayerCardContext
}

export interface WindowPosition {
  x: number
  y: number
}

interface OpenOptions {
  readOnly?: boolean
  context?: PlayerCardContext
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
  /** Re-point an open card at another context (the global card's "open him
   *  in that league"). */
  setContext: (playerId: string, context: PlayerCardContext) => void
  /** The surface's own context for a card opened without one — the draft
   *  room sets its seat here on mount, so every existing "open the card"
   *  call inside the room opens the draft card (Queue). Not persisted. */
  ambient: PlayerCardContext | null
  setAmbient: (context: PlayerCardContext | null) => void
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
      ambient: null,
      setAmbient: (ambient) => set({ ambient }),
      open: (playerId, opts) =>
        set((state) => {
          const entry: PlayerWindowState = {
            playerId,
            readOnly: opts?.readOnly ?? false,
            context: opts?.context ?? state.ambient ?? GLOBAL_CARD_CONTEXT,
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
      setContext: (playerId, context) =>
        set((state) => ({
          windows: state.windows.map((w) => (w.playerId === playerId ? { ...w, context } : w)),
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
