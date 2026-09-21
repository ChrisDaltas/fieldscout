'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

interface RailPanelShellProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * Shared chrome for every rail panel — the 37px head (title + close ghost on
 * a 1px ink rule) over a flex column body. Panels own their scroll areas:
 * render fixed sections as `shrink-0` and the list as `min-h-0 flex-1
 * overflow-y-auto`.
 */
export function RailPanelShell({ title, onClose, children }: RailPanelShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-chrome-band shrink-0 items-center gap-2 border-b border-ink px-3">
        <span className="mr-auto truncate text-[11px] font-extrabold text-ink">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          title="Close panel"
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      {children}
    </div>
  )
}
