'use client'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { cn } from '@/lib/utils'

/**
 * FieldScout Mobile bottom sheet (handoff §2.4): dimmed backdrop, 24px-radius
 * panel up to 86% of the screen, decorative 36×5 grab handle, 19/600 title
 * with an optional 13/500 sub-line, an optional 32px close button, a
 * scrolling body and an optional pinned footer. Built on the app's Radix
 * `Sheet` (variant `mobile`), so focus trap, Escape and outside-tap close
 * come with it.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  showClose = false,
  footer,
  children,
  bodyClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  showClose?: boolean
  footer?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="mobile"
        hideClose
        overlayClassName="bg-black/[0.32] data-[state=open]:animate-none data-[state=closed]:animate-none"
      >
        <div className="flex flex-none justify-center pb-2 pt-0.5" aria-hidden>
          <span className="h-[5px] w-9 rounded-pill bg-m-b4" />
        </div>
        <div className="flex flex-none items-start gap-3 pb-3 pl-5 pr-4 pt-1">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em] text-m-t1">{title}</SheetTitle>
            {subtitle ? (
              <SheetDescription className="text-[13px] font-medium text-m-t3">{subtitle}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </div>
          {showClose && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="flex size-8 flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b3s"
            >
              <MIcon name="close" size={14} stroke={2.2} />
            </button>
          )}
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-none', bodyClassName)}>{children}</div>
        {footer ? <div className="flex-none">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  )
}
