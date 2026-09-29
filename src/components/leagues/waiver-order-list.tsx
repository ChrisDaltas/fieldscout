import { Badge } from '@/components/ui/badge'
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
    <section className="flex flex-col gap-1.5" aria-labelledby="waiver-order-title" data-waiver-order={view.kind}>
      <h2 id="waiver-order-title" className="fs-overline text-[10px] text-n-3">
        {view.title}
      </h2>
      {view.kind === 'order' ? (
        <>
          <p className="text-[11px] font-medium text-n-3" data-waiver-order-caption>
            {view.caption}
          </p>
          <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3" aria-label={view.title}>
            {view.rows.map((row) => (
              <li
                key={row.team_id}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1',
                  row.mine ? 'border-accent bg-accent-soft' : 'border-n-4 bg-white',
                )}
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
        </>
      ) : (
        <p className="text-[11px] font-medium text-ink" data-waiver-order-copy>
          {view.copy}
        </p>
      )}
    </section>
  )
}
