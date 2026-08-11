'use client'

import { PAGE_MODES, type ListsPageMode, type ListsTab } from './lists-view-state'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Lists v2 — page header (handoff §"Lists page" → Page header).
 *
 * Left to right: the `Lists` heading, the three-segment view-mode toggle
 * (List / Cards / Side by side), the My lists / Saved chip tabs with their
 * counts in mono, and `New list` pushed right.
 *
 * **Every resting / hover / active colour below is a CSS class.** The handoff's
 * critical implementation note is that an inline `background` outranks the
 * `:hover` rule and silently kills the hover state, so this file contains no
 * `style` prop at all — the segmented buttons and the tabs are pure Tailwind,
 * which is what makes `hover:` reachable.
 *
 * `Side by side` is round 2 (delivery plan §6). It is rendered present but
 * disabled rather than omitted, so the control keeps its designed three-part
 * shape and the missing mode reads as "not yet" instead of "not planned".
 *
 * AI list generation is deliberately absent — LV.5 restyles that surface into
 * the new language and adds it back here (it is still live on the flag-OFF
 * page, so nothing was removed).
 */
interface ListsPageHeaderProps {
  mode: ListsPageMode
  onModeChange: (mode: ListsPageMode) => void
  tab: ListsTab
  onTabChange: (tab: ListsTab) => void
  counts: Record<ListsTab, number>
  /**
   * Right-aligned cluster — `New list`. A slot rather than a fixed button
   * because on desktop the shell header owns the actions column
   * (`app-header.tsx`), while at mobile widths the whole header renders in the
   * page and carries them itself.
   */
  actions?: React.ReactNode
  className?: string
}

const SEGMENT_BASE =
  'inline-flex h-btn-sm items-center gap-1.5 border-r border-n-4 px-2.5 text-[11px] font-bold leading-none transition-colors last:border-r-0'

const TAB_BASE =
  'inline-flex h-btn-sm items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-bold leading-none transition-colors'

export function ListsPageHeader({
  mode,
  onModeChange,
  tab,
  onTabChange,
  counts,
  actions,
  className,
}: ListsPageHeaderProps) {
  return (
    <div className={cn('flex w-full flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <h1 className="shrink-0 text-h5">Lists</h1>

      {/* View mode — segmented, one shared ink box, hairline dividers. */}
      <div
        role="group"
        aria-label="View mode"
        className="inline-flex shrink-0 overflow-hidden rounded-sm border-1 border-ink bg-white"
      >
        {PAGE_MODES.map((option) => {
          const active = mode === option.id
          return (
            <button
              key={option.id}
              type="button"
              disabled={option.disabled}
              aria-pressed={active}
              title={option.disabledReason ?? `${option.label} view`}
              onClick={() => onModeChange(option.id)}
              className={cn(
                SEGMENT_BASE,
                option.disabled
                  ? 'cursor-not-allowed bg-transparent text-n-3 opacity-60'
                  : active
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-transparent text-ink hover:bg-accent-soft hover:text-accent-strong',
              )}
            >
              <Icon name={option.icon} size={12} />
              {option.label}
            </button>
          )
        })}
      </div>

      {/* My lists / Saved — chip tabs, no underline. Inactive stays full-contrast
          ink (never grey), per the handoff. */}
      <div role="tablist" aria-label="Which lists" className="inline-flex shrink-0 gap-0.5">
        {(
          [
            { id: 'mine' as const, label: 'My lists' },
            { id: 'saved' as const, label: 'Saved' },
          ] satisfies { id: ListsTab; label: string }[]
        ).map((option) => {
          const active = tab === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(option.id)}
              className={cn(
                TAB_BASE,
                'bg-transparent hover:bg-accent-soft',
                // Handoff: active = accent text, inactive = full-contrast ink
                // (never grey). Both keep the accent-soft hover wash.
                active ? 'text-accent' : 'text-ink hover:text-accent-strong',
              )}
            >
              {option.label}
              <span className="fs-num text-[9px] font-medium opacity-75">
                {counts[option.id]}
              </span>
            </button>
          )
        })}
      </div>

      {actions ? <span className="ml-auto shrink-0">{actions}</span> : null}
    </div>
  )
}
