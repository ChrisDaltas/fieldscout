'use client'

import { ListChecks } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface CustomizeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftMode: boolean
  onDraftModeChange: (next: boolean) => void
}

export function CustomizeModal({
  open,
  onOpenChange,
  draftMode,
  onDraftModeChange,
}: CustomizeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bg-elevated-2 bg-bg-elevated sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize list</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-text-secondary">
          Turn on the modes that match how you&apos;re using this list.
        </p>

        <ul className="space-y-2">
          <ModeRow
            icon={<ListChecks className="h-4 w-4 text-text-secondary" />}
            title="Draft Mode"
            description="Mark players as drafted as they come off the board. Drafted players grey out so you can keep scanning what's left."
            on={draftMode}
            onChange={onDraftModeChange}
          />
        </ul>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeRow({
  icon,
  title,
  description,
  on,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  description: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={cn(
          'flex w-full items-start gap-3 rounded-md border bg-bg-elevated-2 px-3 py-3 text-left transition-colors hover:bg-bg-elevated-3',
          on ? 'border-foreground' : 'border-bg-elevated-2',
        )}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-elevated-3">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                on
                  ? 'bg-foreground text-background'
                  : 'bg-bg-elevated-3 text-text-tertiary',
              )}
            >
              {on ? 'On' : 'Off'}
            </span>
          </span>
          <span className="mt-1 block text-xs text-text-secondary">
            {description}
          </span>
        </span>
        <span
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            on ? 'bg-foreground' : 'bg-bg-elevated-3',
          )}
        >
          <span
            className={cn(
              'absolute h-4 w-4 rounded-full transition-transform',
              on ? 'translate-x-4 bg-background' : 'translate-x-0.5 bg-foreground',
            )}
          />
        </span>
      </button>
    </li>
  )
}
