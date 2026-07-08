'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const KEY_PREFIX = 'fieldscout.draft-board.marks.'

/** 0 = clear, 1 = marine (marked by me), 2 = green (drafted by others). */
export type BoardMark = 0 | 1 | 2

/**
 * Tap-cycle marks for the draft-mode board, persisted to localStorage keyed
 * by the SET of lists on the board (order-insensitive) so a draft's marks
 * survive a refresh without bleeding between different boards.
 *
 * UI-only state, never written to the DB — same philosophy as
 * `use-draft-mode.ts`, which models a single list's boolean drafted flags
 * (shared with the list detail page) rather than this per-set 3-state cycle.
 */
export function useBoardMarks(listIds: string[]) {
  const storageKey = useMemo(
    () => KEY_PREFIX + [...listIds].sort().join('+'),
    [listIds],
  )
  const [marks, setMarks] = useState<Record<string, 1 | 2>>({})
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(false)
    try {
      const raw = window.localStorage.getItem(storageKey)
      const next: Record<string, 1 | 2> = {}
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(
            parsed as Record<string, unknown>,
          )) {
            if (value === 1 || value === 2) next[key] = value
          }
        }
      }
      setMarks(next)
    } catch {
      setMarks({})
    }
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(marks))
    } catch {
      // ignore quota errors
    }
  }, [marks, hydrated, storageKey])

  const markOf = useCallback(
    (listId: string, playerId: string): BoardMark =>
      marks[`${listId}:${playerId}`] ?? 0,
    [marks],
  )

  const cycle = useCallback((listId: string, playerId: string) => {
    setMarks((cur) => {
      const key = `${listId}:${playerId}`
      const next = (((cur[key] ?? 0) + 1) % 3) as BoardMark
      const out = { ...cur }
      if (next === 0) delete out[key]
      else out[key] = next
      return out
    })
  }, [])

  return { markOf, cycle }
}
