'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { cn } from '@/lib/utils'

import { catalogue, colDef, colDesc, GROUP_LABEL, type ColGroup, type ColKey, type Surface } from './players-ops'

/**
 * FieldScout Mobile — the Players tab's two overlays: the column tip (spec
 * m-players §2.7) and the Customize stats sheet (§2.8).
 */

/**
 * Column tip: a centred card over the whole screen (backdrop .18) with the
 * column's abbreviation, full name and description, and "Sort by this" /
 * "Sorted by this". Sorting is always high-to-low. A modal overlay, so it
 * keeps its resting shadow (CLAUDE.md → Elevation): the spec's
 * 0 12px 32px rgba(0,0,0,.2), `shadow-m-tip`.
 */
export function ColumnTip({
  colKey,
  surface,
  sort,
  onSort,
  onClose,
}: {
  colKey: ColKey | null
  surface: Surface
  sort: ColKey
  onSort: (key: ColKey) => void
  onClose: () => void
}) {
  const def = colKey ? colDef(colKey) : null
  const sorted = colKey === sort
  return (
    <DialogPrimitive.Root open={def !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/[0.18]" />
        {def && (
          <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-6">
            <DialogPrimitive.Content
              onOpenAutoFocus={(e) => e.preventDefault()}
              className="pointer-events-auto flex w-full max-w-[300px] flex-col gap-2 rounded-[18px] bg-m-b0 p-4 text-m-t1 shadow-m-tip outline-none"
              data-column-tip={def.key}
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-m-t3">{def.abbr}</span>
                  <DialogPrimitive.Title className="text-[17px] font-bold tracking-[-0.01em]">{def.name}</DialogPrimitive.Title>
                </div>
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="flex size-7 flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1"
                >
                  <MIcon name="close" size={12} stroke={2.2} />
                </DialogPrimitive.Close>
              </div>
              <DialogPrimitive.Description className="text-pretty text-[13px] font-medium leading-[1.45] text-m-t2">
                {colDesc(def, surface)}
              </DialogPrimitive.Description>
              <button
                type="button"
                onClick={() => {
                  if (!sorted) onSort(def.key)
                  onClose()
                }}
                aria-pressed={sorted}
                className={cn(
                  'mt-1 flex h-9 items-center justify-center rounded-full text-[13px] font-semibold',
                  sorted ? 'bg-m-b3s text-m-t2' : 'bg-accent text-white',
                )}
              >
                {sorted ? 'Sorted by this' : 'Sort by this'}
              </button>
            </DialogPrimitive.Content>
          </div>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Customize stats: one block per group, a chip per column (on = accent
 * fill). A chip toggles at once and the list behind updates live; Done (or
 * the backdrop) closes. Only columns with a real source are offered.
 */
export function CustomizeSheet({
  open,
  onOpenChange,
  surface,
  cols,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  surface: Surface
  cols: readonly ColKey[]
  onToggle: (key: ColKey) => void
}) {
  const groups: Array<{ group: ColGroup; keys: ColKey[] }> = []
  for (const c of catalogue(surface)) {
    const last = groups[groups.length - 1]
    if (last && last.group === c.group) last.keys.push(c.key)
    else groups.push({ group: c.group, keys: [c.key] })
  }
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Customize stats"
      subtitle="Pick the stats shown in the list and sheet views"
      footer={
        <div className="px-5 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-[50px] w-full items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-white active:bg-accent-strong"
          >
            Done
          </button>
        </div>
      }
    >
      {groups.map(({ group, keys }) => (
        <div key={group}>
          <div className="px-5 pb-1.5 pt-1 text-[12px] font-semibold text-m-t3">{GROUP_LABEL[group]}</div>
          <div className="flex flex-wrap gap-1.5 px-5 pb-4">
            {keys.map((key) => {
              const on = cols.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(key)}
                  className={cn('flex min-w-0 flex-none flex-col gap-0.5 rounded-[14px] px-3.5 py-2', on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1')}
                  data-col-chip={key}
                >
                  <span className="whitespace-nowrap text-[14px] font-semibold">{colDef(key).chip}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </MobileSheet>
  )
}
