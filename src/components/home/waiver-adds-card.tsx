'use client'

import { HomePlayerRow } from '@/components/home/home-player-row'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Top waiver adds (package screen 01, right column) — add % / rostered % /
 * FAAB columns.
 *
 * TODO(live-draft): waiver activity is league-platform data (rostered %,
 * add counts, FAAB spend) with no backend today. The rows below are
 * clearly-marked mock data; replace with the league waiver feed when it
 * exists.
 */

interface MockWaiverAdd {
  name: string
  position: string
  team: string
  rostered: number
  addPct: number
  faab: string
}

// TODO(live-draft): mock rows — real names, illustrative numbers.
const MOCK_WAIVERS: MockWaiverAdd[] = [
  { name: 'Jaylen Warren', position: 'RB', team: 'PIT', rostered: 48, addPct: 31, faab: '18%' },
  { name: 'Demario Douglas', position: 'WR', team: 'NE', rostered: 39, addPct: 24, faab: '9%' },
  { name: 'Cade Otton', position: 'TE', team: 'TB', rostered: 55, addPct: 22, faab: '12%' },
  { name: 'Tyjae Spears', position: 'RB', team: 'TEN', rostered: 61, addPct: 18, faab: '15%' },
  { name: 'Jalen McMillan', position: 'WR', team: 'TB', rostered: 20, addPct: 16, faab: '6%' },
]

export function WaiverAddsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top waiver adds</CardTitle>
        <span className="text-[10px] font-medium tracking-[0.01em] text-n-3">
          This week
        </span>
      </CardHeader>
      <div className="divide-y divide-n-4">
        {MOCK_WAIVERS.map((p) => (
          <HomePlayerRow
            key={p.name}
            name={p.name}
            position={p.position}
            meta={
              <>
                {p.team} · <span className="fs-num">{p.rostered}%</span> rostered
              </>
            }
            right={
              <>
                <div className="fs-num text-[11px] font-extrabold text-positive-strong">
                  +{p.addPct}%
                </div>
                <div className="fs-num text-[9px] font-medium text-n-3">
                  {p.faab} FAAB
                </div>
              </>
            }
          />
        ))}
      </div>
    </Card>
  )
}
