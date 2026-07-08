import { cn } from '@/lib/utils'

export type PositionCode = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'FLEX'

interface PositionBadgeProps {
  position: string
  size?: 'sm' | 'md'
  className?: string
}

const STYLES: Record<string, string> = {
  QB: 'bg-pos-qb text-white',
  RB: 'bg-pos-rb text-white',
  WR: 'bg-pos-wr text-white',
  TE: 'bg-pos-te text-white',
  K: 'bg-pos-k text-white',
  DEF: 'bg-pos-def text-white',
  DST: 'bg-pos-def text-white',
  FLEX: 'bg-pos-flex text-white',
}

export function PositionBadge({
  position,
  size = 'sm',
  className,
}: PositionBadgeProps) {
  const style = STYLES[position] ?? STYLES.FLEX
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-sm border border-ink font-sans font-extrabold',
        size === 'sm' ? 'h-[15px] min-w-[26px] px-1 text-[9px]' : 'h-chip px-1.5 text-[11px]',
        style,
        className,
      )}
    >
      {position}
    </span>
  )
}
