import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** Tools available in the right-hand research rail. */
export type RailTool = 'notifications' | 'messages' | 'teams' | 'players'

interface RailStore {
  /** Which rail panel is open — `null` means the panel is closed. */
  openTool: RailTool | null

  setOpenTool: (tool: RailTool | null) => void
  /** Clicking the active tool closes the panel; any other tool switches to it. */
  toggleTool: (tool: RailTool) => void
  closeRail: () => void
}

/**
 * Research-rail UI state, persisted so the open panel survives navigation and
 * reloads (localStorage key `fieldscout.rail`). `createJSONStorage` reads
 * localStorage lazily and swallows access errors, so the store is safe to
 * import in an SSR pass — components should still gate persisted state behind
 * a mounted flag to avoid hydration mismatches (see ResearchRail).
 */
export const useRailStore = create<RailStore>()(
  persist(
    (set) => ({
      openTool: null,

      setOpenTool: (tool) => set({ openTool: tool }),
      toggleTool: (tool) =>
        set((state) => ({ openTool: state.openTool === tool ? null : tool })),
      closeRail: () => set({ openTool: null }),
    }),
    {
      name: 'fieldscout.rail',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ openTool: state.openTool }),
    },
  ),
)
