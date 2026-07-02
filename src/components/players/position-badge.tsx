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
        'inline-flex items-center justify-center rounded-full font-mono font-semibold uppercase tracking-tight',
        size === 'sm' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-xs',
        style,
        className,
      )}
    >
      {position}
    </span>
  )
}
