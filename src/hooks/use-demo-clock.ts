'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A looping 100ms tick clock for the landing page's scripted demos.
 * Returns elapsed ms; wraps to 0 at `loopMs`. Paused while `playing` is
 * false, and restarts from 0 whenever `playing` or `resetKey` changes.
 * `onPass` fires once per loop as the clock crosses `passMs`.
 */
export function useDemoClock({
  loopMs,
  playing = true,
  passMs,
  onPass,
  resetKey,
}: {
  loopMs: number
  playing?: boolean
  passMs?: number
  onPass?: () => void
  resetKey?: unknown
}): number {
  const [t, setT] = useState(0)
  const prevT = useRef(0)
  const onPassRef = useRef(onPass)
  onPassRef.current = onPass

  useEffect(() => {
    setT(0)
    prevT.current = 0
  }, [resetKey, playing])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setT((prev) => (prev + 100 >= loopMs ? 0 : prev + 100)), 100)
    return () => clearInterval(id)
  }, [playing, loopMs])

  useEffect(() => {
    if (passMs !== undefined && prevT.current < passMs && t >= passMs) onPassRef.current?.()
    prevT.current = t
  }, [t, passMs])

  return t
}
