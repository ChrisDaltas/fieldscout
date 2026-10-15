import { PositionBadge, positionFillClass } from '@/components/players/position-badge'
import { cn } from '@/lib/utils'

/**
 * Mobile position chip (README "Position colors"): the shared
 * `PositionBadge` (D497) at the handoff's size — saturated fill, white text,
 * ink text on K and D/ST, "D/ST" for a defence, ink for FLEX.
 * `variant="text"` is the position written in its on-white text colour
 * instead of a chip.
 */
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
  const known = pos !== 'FLEX' && positionFillClass(pos) !== null
  return (
    <PositionBadge
      position={pos}
      label={posLabel(pos)}
      className={cn(
        'min-w-[22px] leading-none',
        pos === 'FLEX' ? 'bg-m-ink text-white' : !known && 'bg-m-b2 text-m-t1',
        className,
      )}
    />
  )
}
