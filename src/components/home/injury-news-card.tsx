'use client'

import { HomePlayerRow } from '@/components/home/home-player-row'
import { Badge } from '@/components/ui/badge'
import { CollapsibleCard } from '@/components/layout/two-column-layout'

/**
 * Injury news (package screen 01) — status-badged rows for the user's
 * players and top-50 names.
 *
 * TODO(live-draft): "your players" scoping needs league rosters (no backend
 * yet), and no injury-news feed is synced. Mock rows below; wire to the real
 * feed + roster overlap when they exist.
 */

type InjuryStatus = 'Out' | 'Questionable' | 'Active'

interface MockInjury {
  name: string
  position: string
  team: string
  status: InjuryStatus
  note: string
  /** TODO(live-draft): league-scoped — requires the user's league rosters. */
  mine: boolean
}

// TODO(live-draft): mock rows — real names, illustrative notes.
const MOCK_INJURIES: MockInjury[] = [
  {
    name: 'Garrett Wilson',
    position: 'WR',
    team: 'NYJ',
    status: 'Questionable',
    note: 'Hamstring — limited Wednesday, trending toward playing.',
    mine: true,
  },
  {
    name: 'Jaylen Waddle',
    position: 'WR',
    team: 'MIA',
    status: 'Out',
    note: 'Knee — ruled out Sunday, targeting a return in two weeks.',
    mine: true,
  },
  {
    name: 'Christian McCaffrey',
    position: 'RB',
    team: 'SF',
    status: 'Active',
    note: 'Full practice — no injury designation.',
    mine: true,
  },
  {
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    status: 'Questionable',
    note: 'Knee — game-time decision, monitor inactives.',
    mine: false,
  },
]

const STATUS_VARIANT: Record<InjuryStatus, 'pink' | 'yellow' | 'green'> = {
  Out: 'pink',
  Questionable: 'yellow',
  Active: 'green',
}

export function InjuryNewsCard() {
  return (
    <CollapsibleCard
      title="Injury report"
      headerRight={<Badge variant="stroke">Your players + top 50</Badge>}
    >
      <div className="divide-y divide-n-4">
        {MOCK_INJURIES.map((p) => (
          <HomePlayerRow
            key={p.name}
            name={p.name}
            position={p.position}
            meta={p.team}
            nameBadge={
              p.mine ? (
                <Badge variant="stroke" className="h-4 shrink-0 px-1.5 text-[9px]">
                  On your team
                </Badge>
              ) : undefined
            }
            note={p.note}
            right={<Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>}
          />
        ))}
      </div>
    </CollapsibleCard>
  )
}
