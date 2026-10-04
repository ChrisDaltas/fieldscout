import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { Crest, TeamNameLink } from './league-cells'
import type { WaiverOrderListView } from './waiver-claims-ops'

/**
 * WaiverOrderList — the whole league's waiver order on the standings page
 * (M5 task L.D3.15, PROGRESS F494; spec §13.2 Q72 / v2.16.72, §16.1).
 *
 * Props only — `waiverOrderListView` (waiver-claims-ops.ts) has already
 * turned the standings read's STORED `waiver_priority` into rows and words;
 * this paints them. A rolling order lists every team #1 first; a FAAB league
 * with the rolling tiebreak titles it as the tie order for equal bids; a
 * standings-based league says what decides (never a stale number); a rolling
 * league with nothing stored yet says where the order starts.
 *
 * The viewer's own team carries a resting FILL (`bg-accent-soft`), never a
 * shadow; the rows are not interactive (the team name is the link), so
 * nothing lifts (CLAUDE.md's elevation rule).
 */
export function WaiverOrderList({ view, leagueId }: { view: WaiverOrderListView; leagueId: string }) {
  if (view.kind === 'hidden') return null
  return (
    <Card role="region" aria-labelledby="waiver-order-title" data-waiver-order={view.kind}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle id="waiver-order-title" className="text-[12px]">
          {view.title}
        </CardTitle>
      </CardHeader>
      {view.kind === 'order' ? (
        <CardContent className="flex flex-col px-0 py-0">
          <p className="px-card-pad pt-2 text-[11px] font-medium text-n-3" data-waiver-order-caption>
            {view.caption}
          </p>
          <ol className="flex flex-col divide-y divide-n-4" aria-label={view.title}>
            {view.rows.map((row) => (
              <li
                key={row.team_id}
                className={cn('flex min-w-0 items-center gap-2 px-card-pad py-1.5', row.mine && 'bg-accent-soft')}
                data-waiver-order-team={row.team_id}
                data-waiver-priority={row.priority ?? ''}
                data-mine={row.mine || undefined}
              >
                <span className="fs-num w-7 shrink-0 text-right text-[12px] font-bold text-ink">
                  {row.priority === null ? '—' : `#${row.priority}`}
                </span>
                <Crest name={row.name} src={null} />
                <TeamNameLink name={row.name} leagueId={leagueId} teamId={row.team_id} className="truncate text-[12px] font-bold text-ink" />
                {row.mine && (
                  <Badge variant="stroke" className="ml-auto shrink-0 text-[10px]">
                    You
                  </Badge>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      ) : (
        <CardContent className="px-card-pad py-3">
          <p className="text-[11px] font-medium text-ink" data-waiver-order-copy>
            {view.copy}
          </p>
        </CardContent>
      )}
    </Card>
  )
}
