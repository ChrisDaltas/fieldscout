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

// Position filters are the one exception to the black-selected rule: a
// selected position chip fills with that position's colour. Applied via
// className so it overrides FilterChip's default ink "on" state. Full literal
// strings so Tailwind's scanner emits them. 'All' has no entry → stays black.
export const POSITION_FILTER_ACTIVE: Record<string, string> = {
  QB: 'bg-pos-qb text-white hover:bg-pos-qb',
  RB: 'bg-pos-rb text-white hover:bg-pos-rb',
  WR: 'bg-pos-wr text-white hover:bg-pos-wr',
  TE: 'bg-pos-te text-white hover:bg-pos-te',
  FLEX: 'bg-pos-flex text-white hover:bg-pos-flex',
  K: 'bg-pos-k text-white hover:bg-pos-k',
  DEF: 'bg-pos-def text-white hover:bg-pos-def',
  DST: 'bg-pos-def text-white hover:bg-pos-def',
}

// Same idea for Tabs-based position filters (data-state driven).
export const POSITION_TAB_ACTIVE: Record<string, string> = {
  QB: 'data-[state=active]:bg-pos-qb data-[state=active]:text-white',
  RB: 'data-[state=active]:bg-pos-rb data-[state=active]:text-white',
  WR: 'data-[state=active]:bg-pos-wr data-[state=active]:text-white',
  TE: 'data-[state=active]:bg-pos-te data-[state=active]:text-white',
  FLEX: 'data-[state=active]:bg-pos-flex data-[state=active]:text-white',
  K: 'data-[state=active]:bg-pos-k data-[state=active]:text-white',
  DEF: 'data-[state=active]:bg-pos-def data-[state=active]:text-white',
  DST: 'data-[state=active]:bg-pos-def data-[state=active]:text-white',
}

// Big Board card ring — the card is outlined in its position's colour. Full
// literal strings so Tailwind's scanner emits them.
export const POSITION_RING: Record<string, string> = {
  QB: 'ring-pos-qb',
  RB: 'ring-pos-rb',
  WR: 'ring-pos-wr',
  TE: 'ring-pos-te',
  FLEX: 'ring-pos-flex',
  K: 'ring-pos-k',
  DEF: 'ring-pos-def',
  DST: 'ring-pos-def',
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
