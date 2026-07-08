'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Standard content + context layout. The main column fills the available
 * width; the aside (context) column is capped at a mobile-compliant 374px on
 * desktop and stacks below on mobile. Pair the aside with <CollapsibleCard>s
 * so the context content folds into single-row menus on mobile, keeping the
 * main content reachable by a short scroll.
 */
export function TwoColumnLayout({
  main,
  aside,
  className,
}: {
  main: React.ReactNode
  aside: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{main}</div>
      <div className="flex w-full flex-col gap-4 lg:w-[374px] lg:shrink-0">
        {aside}
      </div>
    </div>
  )
}

interface CollapsibleCardProps {
  title: React.ReactNode
  /** Right-aligned header content (tabs, a "see all" link, a period label). */
  headerRight?: React.ReactNode
  /** Expanded by default on mobile? Desktop is always expanded. */
  defaultOpen?: boolean
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

/**
 * A card that behaves as a normal card on desktop and a collapsible menu row
 * on mobile: the header becomes a toggle with a right-side chevron, and the
 * body folds away. Use for context/aside cards so they don't push the main
 * content down the page on small screens.
 */
export function CollapsibleCard({
  title,
  headerRight,
  defaultOpen = false,
  className,
  bodyClassName,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn('rounded-sm border border-ink bg-white', className)}>
      <div className="flex min-h-header items-center gap-2 border-b border-ink pr-card-pad">
        {/* Toggle on mobile; inert (always-open) on desktop. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-card-pad py-2.5 text-left lg:pointer-events-none"
        >
          <span className="mr-auto truncate text-h6">{title}</span>
          <Icon
            name="arrow-bottom"
            size={14}
            className={cn(
              'shrink-0 text-n-3 transition-transform lg:hidden',
              open && 'rotate-180',
            )}
          />
        </button>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      <div className={cn(!open && 'hidden lg:block', bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
