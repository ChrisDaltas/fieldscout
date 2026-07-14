/**
 * Position filter semantics shared by the boards: FLEX = RB/WR/TE,
 * DEF matches both DEF and DST spellings, ALL matches everything.
 */
export function matchesPosition(position: string, filter: string): boolean {
  if (filter === 'ALL') return true
  if (filter === 'FLEX') return ['RB', 'WR', 'TE'].includes(position)
  if (filter === 'DEF' || filter === 'DST') return position === 'DEF' || position === 'DST'
  return position === filter
}
