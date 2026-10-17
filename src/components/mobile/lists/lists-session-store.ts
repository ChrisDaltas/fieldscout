import { create } from 'zustand'

import type { ListScoring, TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'

/**
 * FieldScout Mobile — Lists session state: each list's time frame (Week N /
 * Last 3 / Season) and the scoring its points follow (PPR / Half / Quarter /
 * Standard, gap list #19). The design saves the time frame with the list; in
 * the app a list's display choices are session-only (D3,
 * `list-display-store.ts`, kept by Chris's #18 ruling), so this is plain,
 * non-persisted state too — it resets on reload, like the stat columns.
 *
 * The ⋯ sheet's two view switches (gap list §3 #3) live here for the same
 * reason: **Check off drafted** (the tick boxes on each row) and **Show
 * notes**. Neither touches a mark or a note — the drafted marks themselves
 * are the account's (`useDraftMode`), and turning the boxes off never clears
 * them (D2: "toggling a view control must never delete").
 */
interface ListsSessionState {
  tfByList: Readonly<Record<string, TimeFrame>>
  scoringByList: Readonly<Record<string, ListScoring>>
  checkOffByList: Readonly<Record<string, boolean>>
  notesByList: Readonly<Record<string, boolean>>
  setTf: (listId: string, tf: TimeFrame) => void
  setScoring: (listId: string, scoring: ListScoring) => void
  setCheckOff: (listId: string, on: boolean) => void
  setNotes: (listId: string, on: boolean) => void
}

export const useListsSessionStore = create<ListsSessionState>()((set) => ({
  tfByList: {},
  scoringByList: {},
  checkOffByList: {},
  notesByList: {},
  setTf: (listId, tf) => set((state) => ({ tfByList: { ...state.tfByList, [listId]: tf } })),
  setScoring: (listId, scoring) => set((state) => ({ scoringByList: { ...state.scoringByList, [listId]: scoring } })),
  setCheckOff: (listId, on) => set((state) => ({ checkOffByList: { ...state.checkOffByList, [listId]: on } })),
  setNotes: (listId, on) => set((state) => ({ notesByList: { ...state.notesByList, [listId]: on } })),
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

/**
 * Whether the rows show their drafted tick boxes. Until it's switched, it
 * follows the list: on once anyone on it is marked (so marks made on another
 * device can be unticked here), off on a list nobody's marked yet.
 */
export function useListCheckOff(listId: string, hasMarks: boolean): [boolean, (on: boolean) => void] {
  const chosen = useListsSessionStore((state) => state.checkOffByList[listId])
  const setCheckOff = useListsSessionStore((state) => state.setCheckOff)
  return [chosen ?? hasMarks, (on: boolean) => setCheckOff(listId, on)]
}

/** Whether each player's note shows under their row; off until switched. */
export function useListNotes(listId: string): [boolean, (on: boolean) => void] {
  const shown = useListsSessionStore((state) => state.notesByList[listId] ?? false)
  const setNotes = useListsSessionStore((state) => state.setNotes)
  return [shown, (on: boolean) => setNotes(listId, on)]
}
