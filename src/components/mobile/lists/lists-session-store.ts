import { create } from 'zustand'

import type { TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'

/**
 * FieldScout Mobile — Lists session state: each list's time frame (Week N /
 * Last 3 / Season). The design saves it with the list; in the app a list's
 * display choices are session-only (D3, `list-display-store.ts`), so this is
 * plain, non-persisted state too — it resets on reload, like the stat columns.
 */
interface ListsSessionState {
  tfByList: Readonly<Record<string, TimeFrame>>
  setTf: (listId: string, tf: TimeFrame) => void
}

export const useListsSessionStore = create<ListsSessionState>()((set) => ({
  tfByList: {},
  setTf: (listId, tf) => set((state) => ({ tfByList: { ...state.tfByList, [listId]: tf } })),
}))

export function useListTimeFrame(listId: string): [TimeFrame, (tf: TimeFrame) => void] {
  const tf = useListsSessionStore((state) => state.tfByList[listId] ?? 'week')
  const setTf = useListsSessionStore((state) => state.setTf)
  return [tf, (next: TimeFrame) => setTf(listId, next)]
}
