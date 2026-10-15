import { cn } from '@/lib/utils'

/**
 * Home's section title row (m-home §2A): a 17/600 title (line box 20px) and
 * an optional right-hand part — the Matchups week, or a "See all" link.
 * `align` is the design's own per-row choice (baseline vs centre).
 */
export function HomeSectionTitle({
  title,
  right,
  align = 'baseline',
  className,
}: {
  title: string
  right?: React.ReactNode
  align?: 'baseline' | 'center'
  className?: string
}) {
  return (
    <div className={cn('flex justify-between', align === 'baseline' ? 'items-baseline' : 'items-center', className)}>
      <h2 className="text-[17px] font-semibold leading-[20px] tracking-[-0.01em] text-m-t1">{title}</h2>
      {right}
    </div>
  )
}

/** A quiet centred line for an empty / error state inside a section. */
export function HomeNote({
  children,
  action,
  tone = 'muted',
}: {
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
  tone?: 'muted' | 'error'
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-5 text-center" role={tone === 'error' ? 'alert' : undefined}>
      <p className="text-[13px] font-medium leading-[1.4] text-m-t3">{children}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="text-[13px] font-semibold leading-[16px] text-accent">
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Skeleton rows in the design language (rounded b1 bars). */
export function HomeRowSkeletons({ count, height }: { count: number; height: number }) {
  return (
    <div className="mt-1 flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="block rounded-[14px] bg-m-b1" style={{ height }} />
      ))}
    </div>
  )
}
