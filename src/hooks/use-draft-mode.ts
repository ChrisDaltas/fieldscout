'use client'

import { useCallback, useEffect, useState } from 'react'

const KEY = (listId: string) => `fieldscout.draft-mode.${listId}`
const DRAFTED_KEY = (listId: string) => `fieldscout.drafted.${listId}`

/**
 * Local-only "draft mode" state per list. We persist to localStorage so the
 * draft survives a refresh, but it's never written to the DB — a draft is a
 * temporary live-event view, not a permanent property of the list.
 */
export function useDraftMode(listId: string) {
  const [enabled, setEnabled] = useState(false)
  const [drafted, setDrafted] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setEnabled(window.localStorage.getItem(KEY(listId)) === '1')
      const raw = window.localStorage.getItem(DRAFTED_KEY(listId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setDrafted(new Set(parsed))
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [listId])

  useEffect(() => {
    if (!hydrated) return
    try {
      if (enabled) window.localStorage.setItem(KEY(listId), '1')
      else window.localStorage.removeItem(KEY(listId))
    } catch {
      // ignore
    }
  }, [enabled, hydrated, listId])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(
        DRAFTED_KEY(listId),
        JSON.stringify(Array.from(drafted)),
      )
    } catch {
      // ignore
    }
  }, [drafted, hydrated, listId])

  const toggleDrafted = useCallback((playerId: string) => {
    setDrafted((cur) => {
      const next = new Set(cur)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }, [])

  const clearDrafted = useCallback(() => setDrafted(new Set()), [])

  return {
    enabled,
    setEnabled,
    drafted,
    toggleDrafted,
    clearDrafted,
  }
}
