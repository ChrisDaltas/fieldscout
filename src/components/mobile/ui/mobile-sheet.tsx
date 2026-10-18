'use client'

import { useEffect, useRef } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { useSheetSwipe } from '@/components/mobile/ui/sheet-swipe'
import { cn } from '@/lib/utils'

/** The header's blue pill (lr-frame §2.10): Done, Cancel or Submit. With no
 *  `onClick` it closes the sheet, as the design's Done and Cancel do. */
export interface MobileSheetAction {
  label: string
  onClick?: () => void
  disabled?: boolean
}

/**
 * FieldScout Mobile bottom sheet (handoff §2.4): dimmed backdrop, 24px-radius
 * panel up to 86% of the screen, 36×5 grab handle, 19/600 title with an
 * optional 13/500 sub-line, a scrolling body and an optional pinned footer.
 * The header's right end holds either the Lists and Rankings file's blue
 * `action` pill (Done / Cancel / Submit, lr-frame §2.10) or an optional 32px
 * close button — a sheet shows one or the other, never both.
 *
 * It slides up as it opens and back down as it closes (200ms linear, the
 * README's motion; none under reduced motion), and it can be pulled down to
 * close (`sheet-swipe.ts`) — gap list §4 item 3. Built on the app's Radix
 * `Sheet` (variant `mobile`), so focus trap, Escape and outside-tap close
 * come with it.
 *
 * `size="tall"` holds the sheet at its full 86% instead of fitting its
 * content — for step-by-step flows, so the sheet doesn't jump in height as
 * the steps change. `scrollKey` (the step) returns the body to its top when
 * it changes, so each step opens at its start.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  action,
  showClose = false,
  footer,
  children,
  bodyClassName,
  size = 'fit',
  scrollKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  action?: MobileSheetAction
  showClose?: boolean
  footer?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
  size?: 'fit' | 'tall'
  scrollKey?: string | number
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  const panelRef = useSheetSwipe(open, () => onOpenChange(false))
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={panelRef}
        side="mobile"
        hideClose
        className={size === 'tall' ? 'h-[86%]' : undefined}
        overlayClassName="bg-black/[0.32] ease-linear motion-reduce:!animate-none"
      >
        {/* The grab zone: a mouse pulls the sheet from here (a finger can
            pull from anywhere on it). */}
        <div className="flex-none touch-none select-none" data-sheet-grab>
          <div className="flex justify-center pb-2 pt-0.5" aria-hidden>
            <span className="h-[5px] w-9 rounded-pill bg-m-b4" />
          </div>
          <div className={cn('flex gap-3 pb-3 pl-5 pr-4 pt-1', action ? 'items-center' : 'items-start')}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em] text-m-t1">{title}</SheetTitle>
              {subtitle ? (
                <SheetDescription className="text-[13px] font-medium text-m-t3">{subtitle}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">{title}</SheetDescription>
              )}
            </div>
            {action ? (
              <button
                type="button"
                onClick={action.onClick ?? (() => onOpenChange(false))}
                disabled={action.disabled}
                className="flex h-8 flex-none items-center whitespace-nowrap rounded-pill bg-accent px-3.5 text-[13px] font-semibold text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3"
                data-sheet-action
              >
                {action.label}
              </button>
            ) : showClose ? (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="flex size-8 flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b3s"
              >
                <MIcon name="close" size={14} stroke={2.2} />
              </button>
            ) : null}
          </div>
        </div>
        <div ref={bodyRef} className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-none', bodyClassName)}>
          {children}
        </div>
        {footer ? <div className="flex-none">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  )
}
