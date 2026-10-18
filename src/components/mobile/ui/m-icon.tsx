import { cn } from '@/lib/utils'

/**
 * The mobile handoff's icon set (FieldScout Mobile prototype `ICON` table and
 * the inline paths it uses). 16×16 viewBox stroke icons with round caps and
 * joins — drawn at the size and stroke width each screen's spec gives.
 */
export const M_ICON = {
  trade: 'M3 5.5h9.5L10 3M13 10.5H3.5L6 13',
  add: 'M8 3.5v9M3.5 8h9',
  drop: 'M3.5 8h9',
  sched: 'M3 4.5h10v8.5H3zM3 7.5h10M6 3v3M10 3v3',
  news: 'M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3',
  trans: 'M4 3.5h8v9H4zM6 6.5h4M6 9.5h4',
  search: 'M7 2.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM10.6 10.6L14 14',
  trend: 'M2.5 11.5l4-4 3 3 4-5M10 5.5h3.5V9',
  avail: 'M8 3v10M3 8h10',
  leaders: 'M3 13V9h3v4M6.5 13V5h3v8M10 13V7.5h3V13',
  home: 'M2.5 7.5L8 3l5.5 4.5V13h-11z',
  houseHeader: 'M2.5 7.2L8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z',
  lists: 'M3 4h10M3 8h10M3 12h6',
  rank: 'M4 13V8M8 13V3M12 13V6',
  players: 'M5.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5',
  profile: 'M8 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  match: 'M2.5 4.5h4v7h-4zM9.5 4.5h4v7h-4zM8 3v10',
  menu: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3',
  chat: 'M8 13.5c3.3 0 6-2.4 6-5.5S11.3 2.5 8 2.5 2 4.9 2 8c0 1.2.4 2.3 1.1 3.2L2.5 13.8l2.9-.9c.8.4 1.7.6 2.6.6z',
  close: 'M4 4l8 8M12 4l-8 8',
  back: 'M10 3L5 8l5 5',
  chevronRight: 'M6 3l5 5-5 5',
  chevronUp: 'M4 10l4-4 4 4',
  chevronDown: 'M4 6l4 4 4-4',
  check: 'M3 8.5l3.2 3L13 4.5',
  plus: 'M8 3.5v9M3.5 8h9',
  compose: 'M11 2.5l2.5 2.5L6 12.5H3.5V10zM9.5 4l2.5 2.5',
  scoring: 'M3 13h10M5 10V6M8 10V3M11 10V7',
  playoffs: 'M3 3.5h3v3H3zM3 9.5h3v3H3zM6 5h2.5v6H6M8.5 8H13',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5',
  coowners:
    'M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 2-3.2 4-3.2s3.6 1.2 4 3.2M11 7.5a1.8 1.8 0 1 0 0-3.6M12 9.9c1.3.4 2.2 1.5 2.5 3.1',
  corrections: 'M3 13h10M4.5 10.5l6.8-6.8 1.5 1.5-6.8 6.8H4.5z',
  gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1',
  moon: 'M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1z',
  sun: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  sendUp: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
} as const

export type MIconName = keyof typeof M_ICON

export function MIcon({
  name,
  size = 16,
  stroke = 1.5,
  className,
}: {
  name: MIconName
  size?: number
  stroke?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d={M_ICON[name]} />
    </svg>
  )
}
