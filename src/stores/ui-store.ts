import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Field Scout ink sidebar — package tokens ×0.8 (304/230/380/84).
const SIDEBAR_DEFAULT = 243
const SIDEBAR_MIN = 184
const SIDEBAR_MAX = 304
const SIDEBAR_COLLAPSED = 67

interface UIStore {
  sidebarWidth: number
  isSidebarCollapsed: boolean
  isCommandPaletteOpen: boolean
  isCreateListOpen: boolean
  /** When set, the global create-list dialog adds this player to the new list. */
  createListSeedPlayerId: string | null
  isHistoryExpanded: boolean

  setSidebarWidth: (width: number) => void
  toggleSidebarCollapsed: () => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setCreateListOpen: (open: boolean) => void
  setCreateListSeedPlayerId: (playerId: string | null) => void
  toggleHistoryExpanded: () => void
}

export const SIDEBAR_DIMENSIONS = {
  default: SIDEBAR_DEFAULT,
  min: SIDEBAR_MIN,
  max: SIDEBAR_MAX,
  collapsed: SIDEBAR_COLLAPSED,
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      isSidebarCollapsed: false,
      isCommandPaletteOpen: false,
      isCreateListOpen: false,
      createListSeedPlayerId: null,
      isHistoryExpanded: false,

      setSidebarWidth: (width) =>
        set({
          sidebarWidth: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)),
        }),
      toggleSidebarCollapsed: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
      toggleCommandPalette: () =>
        set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
      setCreateListOpen: (open) => set({ isCreateListOpen: open }),
      setCreateListSeedPlayerId: (playerId) =>
        set({ createListSeedPlayerId: playerId }),
      toggleHistoryExpanded: () =>
        set((state) => ({ isHistoryExpanded: !state.isHistoryExpanded })),
    }),
    {
      name: 'fieldscout.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        isSidebarCollapsed: state.isSidebarCollapsed,
        isHistoryExpanded: state.isHistoryExpanded,
      }),
    },
  ),
)
