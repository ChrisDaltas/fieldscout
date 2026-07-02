'use client'

import Link from 'next/link'
import { ChevronDown, ChevronRight, History as HistoryIcon, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useHistoryStore, type HistoryEntry } from '@/stores/history-store'
import { useUIStore } from '@/stores/ui-store'

interface SidebarHistoryProps {
  collapsed: boolean
}

export function SidebarHistory({ collapsed }: SidebarHistoryProps) {
  const entries = useHistoryStore((s) => s.entries)
  const isExpanded = useUIStore((s) => s.isHistoryExpanded)
  const toggleExpanded = useUIStore((s) => s.toggleHistoryExpanded)

  if (collapsed) {
    return (
      <button
        type="button"
        title="History"
        onClick={toggleExpanded}
        className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
      >
        <HistoryIcon className="h-5 w-5" />
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
      >
        <HistoryIcon className="h-5 w-5 shrink-0" />
        <span className="flex-1 text-left">History</span>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 max-h-72 overflow-y-auto pr-1">
          {entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">No history yet</p>
          ) : (
            <ul className="space-y-0.5">
              {entries.slice(0, 12).map((entry) => (
                <HistoryRow key={entry.href + entry.visitedAt} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  return (
    <li>
      <Link
        href={entry.href}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
      >
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated-2 text-text-tertiary',
            entry.imageUrl && 'overflow-hidden bg-transparent',
          )}
        >
          {entry.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <User className="h-3 w-3" />
          )}
        </span>
        <span className="flex-1 truncate">{entry.name}</span>
        {entry.subtitle && (
          <span className="truncate text-[10px] text-text-tertiary">
            {entry.subtitle}
          </span>
        )}
      </Link>
    </li>
  )
}
