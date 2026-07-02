'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Pin } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SidebarSubsectionItem {
  id: string
  title: string
  href: string
}

interface SidebarSubsectionProps {
  label: string
  /** Icon rendered to the left of the section label. */
  icon?: ReactNode
  items: SidebarSubsectionItem[]
  emptyHint: string
  /** Initial expanded state. Defaults to true. */
  defaultExpanded?: boolean
  /** Pin-mark the items (used for the Pinned section). */
  starred?: boolean
  /** Optional "See all" link shown after the list. */
  seeAllHref?: string
  maxItems?: number
}

export function SidebarSubsection({
  label,
  icon,
  items,
  emptyHint,
  defaultExpanded = true,
  starred = false,
  seeAllHref,
  maxItems = 5,
}: SidebarSubsectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const visibleItems = items.slice(0, maxItems)
  const hasMore = items.length > maxItems

  return (
    <div className="group/section">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-3 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          {icon && (
            <span aria-hidden className="text-text-tertiary">
              {icon}
            </span>
          )}
          <span>{label}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'opacity-0 transition-opacity group-hover/section:opacity-100',
            !expanded && 'opacity-100',
          )}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <ul className="space-y-0.5 pt-0.5">
          {visibleItems.length === 0 ? (
            <li className="px-3 py-1 text-[11px] text-text-tertiary">
              {emptyHint}
            </li>
          ) : (
            visibleItems.map((item) => (
              <DroppableListItem key={item.id} item={item} starred={starred} />
            ))
          )}
          {hasMore && seeAllHref && (
            <li>
              <Link
                href={seeAllHref}
                className="block rounded-md px-3 py-1 text-[11px] text-text-tertiary transition-colors hover:text-foreground"
              >
                See all →
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function DroppableListItem({
  item,
  starred,
}: {
  item: SidebarSubsectionItem
  starred: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `list-drop:${item.id}`,
    data: { kind: 'list-target', listId: item.id },
  })

  return (
    <li ref={setNodeRef}>
      <Link
        href={item.href}
        className={cn(
          'flex h-8 items-center gap-2 rounded-md px-3 text-xs transition-colors hover:bg-bg-elevated-2 hover:text-foreground',
          isOver
            ? 'bg-foreground/10 text-foreground ring-1 ring-foreground/40'
            : 'text-text-secondary',
        )}
      >
        {starred ? (
          <Pin className="h-3 w-3 shrink-0 fill-foreground text-foreground" />
        ) : (
          <span className="h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
        )}
        <span className="truncate">{item.title}</span>
      </Link>
    </li>
  )
}
