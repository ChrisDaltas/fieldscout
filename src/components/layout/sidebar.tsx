'use client'

import { useEffect, useState } from 'react'

import { SidebarResizeHandle } from '@/components/layout/sidebar-resize-handle'
import { YourListsSidebar } from '@/components/layout/your-lists-sidebar'
import { cn } from '@/lib/utils'
import { SIDEBAR_DIMENSIONS, useUIStore } from '@/stores/ui-store'

export function Sidebar() {
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const isCollapsed = useUIStore((s) => s.isSidebarCollapsed)

  // Avoid hydration flash: only animate width transitions after mount
  const [animateWidth, setAnimateWidth] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateWidth(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const width = isCollapsed ? SIDEBAR_DIMENSIONS.collapsed : sidebarWidth

  return (
    <aside
      style={{ width }}
      className={cn(
        'relative hidden shrink-0 flex-col overflow-hidden rounded-lg bg-bg-elevated text-sidebar-foreground lg:flex',
        animateWidth && 'transition-[width] duration-200 ease-out',
      )}
      aria-label="Your lists"
    >
      <YourListsSidebar collapsed={isCollapsed} />
      <SidebarResizeHandle />
    </aside>
  )
}
