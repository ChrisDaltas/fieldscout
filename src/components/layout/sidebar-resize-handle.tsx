'use client'

import { useCallback, useRef } from 'react'

import { SIDEBAR_DIMENSIONS, useUIStore } from '@/stores/ui-store'

export function SidebarResizeHandle() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const isCollapsed = useUIStore((s) => s.isSidebarCollapsed)
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)
  const draggingRef = useRef(false)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return
      const next = e.clientX
      if (next < SIDEBAR_DIMENSIONS.min - 20) {
        if (!useUIStore.getState().isSidebarCollapsed) {
          useUIStore.setState({ isSidebarCollapsed: true })
        }
        return
      }
      if (useUIStore.getState().isSidebarCollapsed && next > SIDEBAR_DIMENSIONS.min) {
        useUIStore.setState({ isSidebarCollapsed: false })
      }
      setSidebarWidth(next)
    },
    [setSidebarWidth],
  )

  const onPointerUp = useCallback(() => {
    draggingRef.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  if (isCollapsed) return null

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={toggleCollapsed}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-bg-elevated-3"
    />
  )
}
