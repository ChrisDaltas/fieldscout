'use client'

import { PlayerWindow } from '@/components/players/player-window'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

// Above page chrome (top nav is z-40); Radix popovers/menus inside a window
// portal even higher, so their layering still works.
const BASE_Z = 60

/**
 * Renders every open player window. Mounted once at the app root so windows
 * survive route changes and any page can open them via the store.
 */
export function PlayerWindowsLayer() {
  const windows = usePlayerWindowsStore((s) => s.windows)

  return (
    <>
      {windows.map((w, i) => (
        <PlayerWindow
          key={w.playerId}
          window={w}
          stackIndex={i}
          zIndex={BASE_Z + i}
          isTop={i === windows.length - 1}
        />
      ))}
    </>
  )
}
