'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Local ticking pick clock for the mock draft rooms.
 *
 * TODO(live-draft): replace with the server-synced clock from the draft
 * service. This one just counts down locally and rolls back to the full
 * pick clock at zero so the room keeps feeling live during demos.
 *
 * One interval per room; cleaned up on unmount.
 */
export function useMockDraftClock(startSeconds: number) {
  const [seconds, setSeconds] = useState(startSeconds)

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => (s <= 0 ? startSeconds : s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [startSeconds])

  const reset = useCallback(() => setSeconds(startSeconds), [startSeconds])

  return { seconds, reset }
}

/** 48 → "0:48", 75 → "1:15" — mono numerals expected at the call site. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
