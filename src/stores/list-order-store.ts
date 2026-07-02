import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Persists the user's manual ordering of sidebar lists (an array of list ids)
 * to localStorage so the order survives logging out and back in. New lists are
 * appended on the fly; deleted lists are dropped. Drag-reorder calls `move`.
 */
interface ListOrderStore {
  order: string[]
  /** Reconcile the stored order with the current set of list ids. */
  sync: (ids: string[]) => void
  /** Move `activeId` to where `overId` sits. */
  move: (activeId: string, overId: string) => void
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const useListOrderStore = create<ListOrderStore>()(
  persist(
    (set) => ({
      order: [],
      sync: (ids) =>
        set((state) => {
          const idSet = new Set(ids)
          const known = state.order.filter((id) => idSet.has(id))
          const knownSet = new Set(known)
          const missing = ids.filter((id) => !knownSet.has(id))
          if (missing.length === 0 && known.length === state.order.length) {
            return state
          }
          return { order: [...known, ...missing] }
        }),
      move: (activeId, overId) =>
        set((state) => {
          const from = state.order.indexOf(activeId)
          const to = state.order.indexOf(overId)
          if (from < 0 || to < 0 || from === to) return state
          return { order: arrayMove(state.order, from, to) }
        }),
    }),
    {
      name: 'fieldscout.list-order',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
