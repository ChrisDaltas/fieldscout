import { cn } from '@/lib/utils'

/**
 * Mobile position chip (README "Position colors"): saturated fill, white text
 * — ink text on K and D/ST — 4–5px radius. `variant="text"` is the position
 * written in its on-white text colour instead of a chip.
 */
const FILL: Record<string, string> = {
  QB: 'bg-pos-qb text-white',
  RB: 'bg-pos-rb text-white',
  WR: 'bg-pos-wr text-white',
  TE: 'bg-pos-te text-white',
  K: 'bg-pos-k text-ink',
  DEF: 'bg-pos-def text-ink',
  DST: 'bg-pos-def text-ink',
  FLEX: 'bg-m-ink text-white',
}
const TEXT: Record<string, string> = {
  QB: 'text-m-pos-qb',
  RB: 'text-m-pos-rb',
  WR: 'text-m-pos-wr',
  TE: 'text-m-pos-te',
  K: 'text-m-pos-k',
  DEF: 'text-m-pos-dst',
  DST: 'text-m-pos-dst',
}

export function posLabel(pos: string): string {
  return pos === 'DEF' || pos === 'DST' ? 'D/ST' : pos
}

export function posTextClass(pos: string): string {
  return TEXT[pos] ?? 'text-m-t3'
}

export function MPosChip({
  pos,
  variant = 'chip',
  className,
}: {
  pos: string
  variant?: 'chip' | 'text'
  className?: string
}) {
  if (variant === 'text') {
    return <span className={cn('font-semibold', posTextClass(pos), className)}>{posLabel(pos)}</span>
  }
  return (
    <span
      className={cn(
        'inline-flex h-[15px] min-w-[22px] items-center justify-center rounded-sm px-1 text-[9px] font-bold leading-none',
        FILL[pos] ?? 'bg-m-b2 text-m-t1',
        className,
      )}
    >
      {posLabel(pos)}
    </span>
  )
}
