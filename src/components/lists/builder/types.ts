export interface BuilderPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  projected_pts: number | null
}

export interface StatColumnPrefs {
  current: boolean
  last: boolean
  // projected is always shown
}

export const POSITION_FILTERS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
] as const

export type Position = (typeof POSITION_FILTERS)[number]

export const LIST_POSITION_OPTIONS = [
  { value: '', label: 'All positions' },
  { value: 'QB', label: 'Quarterback' },
  { value: 'RB', label: 'Running Back' },
  { value: 'WR', label: 'Wide Receiver' },
  { value: 'TE', label: 'Tight End' },
  { value: 'FLEX', label: 'Flex' },
  { value: 'K', label: 'Kicker' },
  { value: 'DEF', label: 'Defense' },
] as const
