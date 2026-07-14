'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize list</DialogTitle>
        </DialogHeader>
        <p className="text-xs font-medium text-n-3">
          Turn on the modes that match how you&apos;re using this list.
        </p>

        <ul className="space-y-2">
          <ModeRow
            icon={<Icon name="table" size={14} />}
            title="Draft mode"
            description="Mark players as drafted as they come off the board. Drafted players grey out so you can keep scanning what's left."
            on={draftMode}
            onChange={onDraftModeChange}
          />
        </ul>

        <DialogFooter>
          <Button variant="blue" shadow onClick={() => onOpenChange(false)}>
            Done
          </Button>
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
          'flex w-full items-start gap-3 rounded-sm border px-3 py-3 text-left transition-colors',
          on ? 'border-accent bg-accent-soft' : 'border-ink bg-white hover:bg-n-4',
        )}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-ink bg-white text-ink">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{title}</span>
          <span className="mt-1 block text-xs font-medium text-n-3">
            {description}
          </span>
        </span>
        <span className="pointer-events-none shrink-0">
          <Switch checked={on} aria-hidden tabIndex={-1} />
        </span>
      </button>
    </li>
  )
}
