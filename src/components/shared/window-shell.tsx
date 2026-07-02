'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Maximize2, Minimize2, X } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface DetailWindowTab {
  value: string
  label: string
  content: React.ReactNode
}

interface WindowShellProps {
  title: string
  /** Fullscreen vs floating-window disclosure (drag is disabled when expanded). */
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onClose: () => void
  /** Bring this window to the front (called on any pointer-down). */
  onFocus: () => void
  /** Stacking order — higher renders above. */
  zIndex: number
  /** Cascade offset so stacked windows don't open exactly on top of each other. */
  stackIndex: number
  /** Remembered position (from a prior drag); falls back to the cascade. */
  initialPosition?: WindowPosition | null
  /** Called when a drag finishes so the position can be remembered. */
  onPositionChange?: (pos: WindowPosition) => void
  /** Front-most window owns Escape-to-close. */
  isTop: boolean
  header: React.ReactNode
  actions?: React.ReactNode
  tabs: DetailWindowTab[]
  loading?: boolean
  error?: string | null
  loadingFallback?: React.ReactNode
}

const WINDOW_WIDTH = 460

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface WindowPosition {
  x: number
  y: number
}

function cascadePosition(stackIndex: number): WindowPosition {
  if (typeof window === 'undefined') return { x: 80, y: 72 }
  const startX = Math.max(16, Math.round((window.innerWidth - WINDOW_WIDTH) / 2))
  const offset = (stackIndex % 6) * 28
  return { x: startX + offset, y: 72 + offset }
}

/** Remembered position clamped back on-screen (viewport may have changed). */
function resolveInitialPosition(
  saved: WindowPosition | null | undefined,
  stackIndex: number,
): WindowPosition {
  const base = saved ?? cascadePosition(stackIndex)
  if (typeof window === 'undefined') return base
  return {
    x: clamp(base.x, -WINDOW_WIDTH + 100, window.innerWidth - 100),
    y: clamp(base.y, 0, window.innerHeight - 48),
  }
}

/**
 * Floating, draggable window chrome for entity detail views. Unlike a modal
 * there's no backdrop and no focus trap — the page and other windows stay
 * interactive — so several can be open and dragged around independently. Drag
 * by the top control bar; Expand toggles fullscreen; X (or Escape on the front
 * window) closes.
 */
export function WindowShell({
  title,
  expanded,
  onExpandedChange,
  onClose,
  onFocus,
  zIndex,
  stackIndex,
  initialPosition,
  onPositionChange,
  isTop,
  header,
  actions,
  tabs,
  loading = false,
  error = null,
  loadingFallback,
}: WindowShellProps) {
  const [mounted, setMounted] = React.useState(false)
  const [pos, setPos] = React.useState(() =>
    resolveInitialPosition(initialPosition, stackIndex),
  )
  const posRef = React.useRef(pos)
  const [tab, setTab] = React.useState(tabs[0]?.value ?? '')
  const dragRef = React.useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  React.useEffect(() => setMounted(true), [])

  // Select the first tab once the tabs populate (they start empty while data
  // loads), matching the old modal behavior.
  React.useEffect(() => {
    setTab(tabs[0]?.value ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

  React.useEffect(() => {
    if (!isTop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, onClose])

  if (!mounted) return null

  // Drag via pointer capture on the control bar — no global listeners, so it
  // can't leak even if the window unmounts mid-drag.
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (expanded) return
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    }
  }
  const onHandlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const x = clamp(
      d.origX + (e.clientX - d.startX),
      -WINDOW_WIDTH + 100,
      window.innerWidth - 100,
    )
    const y = clamp(d.origY + (e.clientY - d.startY), 0, window.innerHeight - 48)
    posRef.current = { x, y }
    setPos(posRef.current)
  }
  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) onPositionChange?.(posRef.current)
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      onPointerDownCapture={onFocus}
      style={{ zIndex, ...(expanded ? {} : { left: pos.x, top: pos.y }) }}
      className={cn(
        'fixed flex flex-col overflow-hidden rounded-2xl border border-bg-elevated-2 bg-bg-elevated shadow-2xl shadow-black/50',
        expanded
          ? 'inset-3 sm:inset-6'
          : 'h-[560px] max-h-[85vh] w-[460px] max-w-[calc(100vw-1rem)]',
      )}
    >
      {/* 1 — control bar (drag handle) */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        className={cn(
          'flex shrink-0 touch-none items-center justify-between px-4 pt-4 sm:px-6',
          expanded ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        )}
      >
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? 'Collapse to window' : 'Expand to full screen'}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-bg-elevated-3 bg-bg-elevated-2 px-4 text-xs font-semibold text-text-secondary transition-colors hover:text-foreground"
        >
          {expanded ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Collapse</span>
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Expand</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-bg-elevated-3 bg-bg-elevated-2 text-text-secondary transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && <div className="flex-1 overflow-y-auto">{loadingFallback}</div>}

      {error && !loading && (
        <div className="p-6 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="shrink-0">{header}</div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 pb-4 sm:px-6">
              {actions}
            </div>
          )}

          <TabsPrimitive.Root
            value={tab}
            onValueChange={setTab}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="shrink-0 px-4 sm:px-6">
              <TabsPrimitive.List className="flex w-full gap-1.5 overflow-x-auto rounded-full border border-bg-elevated-3 bg-bg-elevated-2 p-1.5">
                {tabs.map((t) => (
                  <TabsPrimitive.Trigger
                    key={t.value}
                    value={t.value}
                    className={cn(
                      'whitespace-nowrap rounded-full border border-transparent px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-foreground',
                      'data-[state=active]:border-bg-elevated-3 data-[state=active]:bg-background data-[state=active]:text-foreground',
                    )}
                  >
                    {t.label}
                  </TabsPrimitive.Trigger>
                ))}
              </TabsPrimitive.List>
            </div>
            {tabs.map((t) => (
              <TabsPrimitive.Content
                key={t.value}
                value={t.value}
                className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none sm:p-6 data-[state=inactive]:hidden"
              >
                {t.content}
              </TabsPrimitive.Content>
            ))}
          </TabsPrimitive.Root>
        </>
      )}
    </div>,
    document.body,
  )
}
