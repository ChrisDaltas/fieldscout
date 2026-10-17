'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * "Show movement" (Chris, 2026-10-15, gap list #33): the ▲3 / ▼2 arrows are
 * ON by default while you view SOMEONE ELSE's ranking (the experts, an AI
 * expert, the users) and OFF while you make or edit your OWN. Each has its
 * own switch, remembered on this device.
 *
 * Storage can be blocked (a private window, site data off): the switch then
 * still works for the visit, and the next visit starts from the default.
 * The server render always uses the defaults, so nothing mismatches when
 * the page hydrates.
 */

export type MovementView = 'others' | 'own'

export const MOVEMENT_PREF_KEY = 'fs.mobile-rankings.show-movement'

export const MOVEMENT_DEFAULTS: Readonly<Record<MovementView, boolean>> = { others: true, own: false }

/** This visit's choices — what the switches show when storage can't hold them. */
const memory: Partial<Record<MovementView, boolean>> = {}
const listeners = new Set<() => void>()

function stored(): Partial<Record<MovementView, boolean>> | null {
  try {
    const raw = window.localStorage.getItem(MOVEMENT_PREF_KEY)
    if (!raw) return {}
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Partial<Record<MovementView, boolean>>) : {}
  } catch {
    return null
  }
}

export function readMovementPref(view: MovementView): boolean {
  const v = stored()?.[view]
  if (typeof v === 'boolean') return v
  return memory[view] ?? MOVEMENT_DEFAULTS[view]
}

export function writeMovementPref(view: MovementView, on: boolean): void {
  memory[view] = on
  try {
    const cur = stored() ?? {}
    window.localStorage.setItem(MOVEMENT_PREF_KEY, JSON.stringify({ ...cur, [view]: on }))
  } catch {
    // Storage blocked: this visit remembers it (memory), the next doesn't.
  }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key === MOVEMENT_PREF_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Whether to show movement here, and the switch that changes it. */
export function useShowMovement(view: MovementView): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribe,
    () => readMovementPref(view),
    () => MOVEMENT_DEFAULTS[view],
  )
  const set = useCallback((next: boolean) => writeMovementPref(view, next), [view])
  return [on, set]
}
