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
  // IDP codes (league roster builder, spec §7.3.2) share the defense grey.
  DL: 'bg-pos-def text-white',
  LB: 'bg-pos-def text-white',
  DB: 'bg-pos-def text-white',
}

// Position pickers are the one exception to the accent-selected rule: the
// selected position fills with that position's own colour. Applied via
// className over the shared tab/segment control, so it must be `data-state`
// driven — a plain `bg-pos-*` loses to the primitive's
// `data-[state=active]:bg-accent`, which carries an extra attribute selector.
// Full literal strings so Tailwind's scanner emits them. A key with no entry
// ('All', 'Overall') has no override → stays the accent fill.
//
// LV.11 deleted this map's `FilterChip` twin (`POSITION_FILTER_ACTIVE`, plain
// `bg-pos-*` + a `hover:` repeat) when the last single-select position chip
// row moved onto `Segment`. A future filter control that needs it again should
// take it from git history rather than re-deriving it.
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
