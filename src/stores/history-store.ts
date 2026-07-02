import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type HistoryEntryType = 'user' | 'player' | 'list'

export interface HistoryEntry {
  type: HistoryEntryType
  href: string
  name: string
  subtitle?: string
  imageUrl?: string
  visitedAt: number
}

interface HistoryStore {
  entries: HistoryEntry[]
  push: (entry: Omit<HistoryEntry, 'visitedAt'>) => void
  clear: () => void
}

const MAX_ENTRIES = 20

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set) => ({
      entries: [],
      push: (entry) =>
        set((state) => {
          const filtered = state.entries.filter((e) => e.href !== entry.href)
          return {
            entries: [{ ...entry, visitedAt: Date.now() }, ...filtered].slice(
              0,
              MAX_ENTRIES,
            ),
          }
        }),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'fieldscout.history',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
