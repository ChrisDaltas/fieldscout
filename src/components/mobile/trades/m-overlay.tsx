'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/** Open overlays, newest last — only the top one answers Escape. */
const stack: string[] = []

/**
 * A FieldScout Mobile full-screen overlay (handoff: Team view, Trade detail,
 * Trade builder — "cover y = 50 to 844 … there is no dock on these
 * screens"). Fixed over the whole app below the device's status bar, above
 * the bottom dock (z-40); sheets, the player view and toasts portal after it
 * and sit on top. Mounts instantly (the handoff animates none of these).
 * Escape closes it, like the handoff's X / back.
 */
export function MOverlay({
  children,
  onClose,
  label,
  className,
}: {
  children: React.ReactNode
  onClose?: () => void
  /** The overlay's accessible name. */
  label: string
  className?: string
}) {
  const [mounted, setMounted] = useState(false)
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setMounted(true)
    stack.push(id)
    return () => {
      const i = stack.lastIndexOf(id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [id])
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      // A sheet or dialog open above this overlay takes the Escape itself.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, id])
  // Move focus into the overlay when it opens (screen readers, keyboards).
  useEffect(() => {
    if (mounted) ref.current?.focus({ preventScroll: true })
  }, [mounted])
  if (!mounted) return null
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cn('fixed inset-0 z-50 flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] font-sans text-m-t1 antialiased outline-none', className)}
      data-m-overlay
    >
      {children}
    </div>,
    document.body,
  )
}

/** The overlay's scroll body (scrollbar hidden). */
export function MOverlayScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none', className)}>{children}</div>
}

/** An on/off switch drawn the handoff's way: a green / b3 track and a b0
 *  knob that jumps (no slide), 40×24 (detail) or 44×26 (builder), its knob
 *  on the handoff's 0 1px 2px .2 (`shadow-m-knob`). */
export function MSwitch({ on, size = 'sm' }: { on: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex flex-none rounded-pill p-0.5 transition-colors duration-200 ease-linear',
        size === 'sm' ? 'h-6 w-10' : 'h-[26px] w-11',
        on ? 'justify-end bg-confirm' : 'justify-start bg-m-b3s',
      )}
    >
      <span className={cn('rounded-full bg-m-b0 shadow-m-knob', size === 'sm' ? 'size-5' : 'size-[22px]')} />
    </span>
  )
}
