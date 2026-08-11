'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '@/components/ui/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface DetailWindowTab {
  value: string
  label: string
  content: React.ReactNode
}

interface WindowShellProps {
  title: string
  onClose: () => void
  /** Bring this window to the front (called on any pointer-down). */
  onFocus: () => void
  /** Open the entity's full page (top-right arrow icon). Hidden when omitted. */
  onExpand?: () => void
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
  /** Identity content rendered inside the draggable header row. */
  header: React.ReactNode
  /** Sections between the header and the tabs (stat grid, actions row, …). */
  children?: React.ReactNode
  tabs: DetailWindowTab[]
  loading?: boolean
  error?: string | null
  loadingFallback?: React.ReactNode
}

// Kit PlayerCard is 380px wide with a 620px height cap, rendered at 0.8 zoom —
// we paint the scaled result directly.
const WINDOW_WIDTH = 304
const WINDOW_MAX_HEIGHT = 'min(496px, calc(100vh - 24px))'

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
 * Floating, draggable mini-card window for entity detail views — Field Scout
 * chrome: white card, 1px ink border, hard offset shadow, near-square corners.
 * Unlike a modal there's no backdrop and no focus trap — the page and other
 * windows stay interactive — so several can be open and dragged around
 * independently. Drag by the header; the arrow icon opens the full page;
 * X (or Escape on the front window) closes.
 */
export function WindowShell({
  title,
  onClose,
  onFocus,
  onExpand,
  zIndex,
  stackIndex,
  initialPosition,
  onPositionChange,
  isTop,
  header,
  children,
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

  // Drag via pointer capture on the header — no global listeners, so it
  // can't leak even if the window unmounts mid-drag.
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
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

  // Elevation exception: a portalled, position-fixed floating window is the
  // literal case elevation is for. See CLAUDE.md → "Elevation".
  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      onPointerDownCapture={onFocus}
      style={{ zIndex, left: pos.x, top: pos.y, maxHeight: WINDOW_MAX_HEIGHT }}
      className="fixed flex w-[304px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-sm border border-ink bg-white text-ink shadow-hard-6"
    >
      {/* header — identity band, doubles as the drag handle */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        className="flex shrink-0 cursor-grab touch-none items-start gap-1 border-b border-ink py-2.5 pl-3 pr-2 active:cursor-grabbing"
      >
        <div className="min-w-0 flex-1">{header}</div>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open full page"
            title="Open full page"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-n-4 hover:text-accent"
          >
            <Icon name="arrow-up-right" size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-n-4 hover:text-accent"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {loading && (
        <div className="min-h-0 flex-1 overflow-y-auto">{loadingFallback}</div>
      )}

      {error && !loading && (
        <p className="p-3 text-[12px] font-semibold text-negative-strong">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children}
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="px-3 pb-3 pt-2.5"
          >
            <TabsList className="flex w-full">
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="min-w-0 flex-1 px-1"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-2.5">
                {t.content}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
    </div>,
    document.body,
  )
}
