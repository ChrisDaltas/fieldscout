'use client'

import { useEffect, useState } from 'react'

/** `value`, once it has held still for `ms` — so a read keyed on what the
 *  user types fires when they pause, not on every keystroke. The first
 *  render returns `value` itself. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
