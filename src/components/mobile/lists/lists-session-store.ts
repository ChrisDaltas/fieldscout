import { create } from 'zustand'

import type { ListScoring, TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'

/**
 * FieldScout Mobile — Lists session state: each list's time frame (Week N /
 * Last 3 / Season) and the scoring its points follow (PPR / Half / Quarter /
 * Standard, gap list #19). The design saves the time frame with the list; in
 * the app a list's display choices are session-only (D3,
 * `list-display-store.ts`, kept by Chris's #18 ruling), so this is plain,
 * non-persisted state too — it resets on reload, like the stat columns.
 */
interface ListsSessionState {
  tfByList: Readonly<Record<string, TimeFrame>>
  scoringByList: Readonly<Record<string, ListScoring>>
  setTf: (listId: string, tf: TimeFrame) => void
  setScoring: (listId: string, scoring: ListScoring) => void
}

export const useListsSessionStore = create<ListsSessionState>()((set) => ({
  tfByList: {},
  scoringByList: {},
  setTf: (listId, tf) => set((state) => ({ tfByList: { ...state.tfByList, [listId]: tf } })),
  setScoring: (listId, scoring) => set((state) => ({ scoringByList: { ...state.scoringByList, [listId]: scoring } })),
}))

export function useListTimeFrame(listId: string): [TimeFrame, (tf: TimeFrame) => void] {
  const tf = useListsSessionStore((state) => state.tfByList[listId] ?? 'week')
  const setTf = useListsSessionStore((state) => state.setTf)
  return [tf, (next: TimeFrame) => setTf(listId, next)]
}

/** The list's stat scoring for this session; PPR until the user picks. */
export function useListScoring(listId: string): [ListScoring, (scoring: ListScoring) => void] {
  const scoring = useListsSessionStore((state) => state.scoringByList[listId] ?? 'ppr')
  const setScoring = useListsSessionStore((state) => state.setScoring)
  return [scoring, (next: ListScoring) => setScoring(listId, next)]
}
