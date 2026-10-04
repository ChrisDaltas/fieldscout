'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { usePlayerModalStore } from '@/stores/player-modal-store'

/**
 * `?player=<id>` (+ `&league=`) opens the player view modal — the landing for
 * a shared link or an old `/app/players/<id>` URL (which redirects here).
 * Closing the modal clears both params, leaving the page under it.
 */
export function PlayerModalUrlSync() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const target = usePlayerModalStore((s) => s.target)
  const playerParam = params.get('player')
  const opened = useRef<string | null>(null)
  // The param's modal has actually been shown — only then does a null
  // target mean "closed" (the first commit still sees null before the open).
  const shown = useRef(false)

  useEffect(() => {
    if (!playerParam || !pathname.startsWith('/app')) return
    opened.current = playerParam
    shown.current = false
    openPlayerView(playerParam, params.get('league') || null)
  }, [playerParam, params, pathname, openPlayerView])

  useEffect(() => {
    if (opened.current === null || playerParam !== opened.current) return
    if (target !== null) {
      shown.current = true
      return
    }
    if (!shown.current) return
    opened.current = null
    shown.current = false
    const next = new URLSearchParams(params.toString())
    next.delete('player')
    next.delete('league')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [target, playerParam, params, pathname, router])

  return null
}
