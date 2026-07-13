import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type BoardLabel = 'drafted' | 'dnd'

interface BoardLabelsStore {
  /** playerId → quick label. Absent = unlabeled. */
  labels: Record<string, BoardLabel>

  /** Toggle: applying the same label again clears it. */
  toggleLabel: (playerId: string, label: BoardLabel) => void
  clearLabel: (playerId: string) => void
  clearAll: () => void
}

/**
 * Big Board quick labels (drafted / do-not-draft). Draft-day scratchpad
 * state, so it persists locally like the board-size preference rather than
 * server-side — labels reset with the browser, which matches how a draft
 * board actually gets used season to season.
 */
export const useBoardLabelsStore = create<BoardLabelsStore>()(
  persist(
    (set) => ({
      labels: {},

      toggleLabel: (playerId, label) =>
        set((state) => {
          const next = { ...state.labels }
          if (next[playerId] === label) {
            delete next[playerId]
          } else {
            next[playerId] = label
          }
          return { labels: next }
        }),

      clearLabel: (playerId) =>
        set((state) => {
          if (!(playerId in state.labels)) return state
          const next = { ...state.labels }
          delete next[playerId]
          return { labels: next }
        }),

      clearAll: () => set({ labels: {} }),
    }),
    {
      name: 'fieldscout.board-labels',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
