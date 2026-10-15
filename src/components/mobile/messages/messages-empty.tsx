import { cn } from '@/lib/utils'

/**
 * Empty / problem state in the Messages design language — the prototype
 * shows a blank list here, so this extends it: centred 15/600 t1 title,
 * 13/500 t3 body, optional actions below.
 */
export function MessagesEmpty({
  title,
  body,
  children,
  className,
  role,
}: {
  title: string
  body?: string
  children?: React.ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div
      role={role}
      className={cn('flex flex-col items-center gap-1.5 px-8 pb-6 pt-12 text-center', className)}
      data-messages-empty
    >
      <p className="text-[15px] font-semibold text-m-t1">{title}</p>
      {body && <p className="max-w-[300px] text-[13px] font-medium leading-[1.4] text-m-t3">{body}</p>}
      {children && <div className="mt-2.5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

/** A b2 pill action inside an empty state (the design's 32px pill). */
export const EMPTY_PILL =
  'inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1 active:bg-m-b2h'
