'use client'

import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { cn } from '@/lib/utils'

import { Crest } from './league-cells'
import {
  formatPoints,
  formatRecord,
  formatWinPct,
  recordColumns,
  renderedChain,
  separatorLabel,
  skipNotes,
  standingsEmptyCopy,
} from './standings-table-ops'

/**
 * StandingsTable (§16.2 `standings-table`: "tiebreaker-ordered, one table,
 * no grouping" — v2.16.12/Q30; §7.3.7; §11.5 — M4 task L.D5.3; PROGRESS
 * D297, D314, D317).
 *
 * ONE table over 117's document, in 117's order. The rows arrive ranked;
 * this component paints them top to bottom and never sorts. The chain strip
 * above the table is `chain` IN STORED ORDER (`renderedChain`), each entry
 * labelled and, when 117 skipped or inerted it, saying why (E63 / E64 /
 * Q30). Each row's `separated_by` renders as the chip that placed it —
 * the RPC's word, never a re-derivation.
 *
 * Empty is BY REASON: `reason: 'no_final_weeks'` renders designed copy over
 * the (still ranked, all-zero) rows; the table never infers emptiness from
 * `standings.length` (rule 10).
 *
 * Numbers are `fs-num` (mono, tabular — the table primitive's contract).
 * Elevation: rows rest flat; the primitive's hover wash is the only
 * interaction paint (CLAUDE.md).
 */
export function StandingsTable({
  doc,
  settings,
  teamNames,
  highlightTeamId,
}: {
  doc: LeagueStandings
  settings: { median_game: boolean; second_opponent: boolean }
  /** `teams.id → name` from the league detail, for the E63 footnote (117's
   *  rows carry their own `name`). */
  teamNames: ReadonlyMap<string, string>
  /** The viewer's own franchise, if any — a resting fill, never a shadow. */
  highlightTeamId: string | null
}) {
  const chain = renderedChain(doc.chain)
  const columns = recordColumns(doc.standings, settings)
  const emptyCopy = standingsEmptyCopy(doc)
  const notes = skipNotes(doc.skipped, teamNames)

  return (
    <div className="flex flex-col gap-3" data-standings-table>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Tiebreaker order" data-chain>
        {chain.map((entry, i) => (
          <li key={entry.entry} className="flex items-center gap-1.5" data-chain-entry={entry.entry}>
            {i > 0 && <span className="text-[10px] font-bold text-n-3">→</span>}
            <Badge
              variant={entry.status === 'applied' ? 'stroke' : 'stroke-pink'}
              className={cn(entry.status !== 'applied' && 'line-through')}
              title={entry.note ?? undefined}
            >
              {entry.label}
            </Badge>
          </li>
        ))}
      </ol>

      {emptyCopy && (
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3">
          {emptyCopy}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">W-L{doc.standings.some((r) => r.ties > 0) ? '-T' : ''}</TableHead>
            <TableHead className="text-right">Win %</TableHead>
            <TableHead className="text-right">PF</TableHead>
            <TableHead className="text-right">PA</TableHead>
            {columns.median && <TableHead className="text-right">vs median</TableHead>}
            {columns.second && <TableHead className="text-right">2nd opp</TableHead>}
            <TableHead>Placed by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.standings.map((row) => {
            const separator = separatorLabel(row.separated_by)
            return (
              <TableRow
                key={row.team_id}
                data-team={row.team_id}
                data-separated-by={row.separated_by ?? ''}
                className={cn(row.team_id === highlightTeamId && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <TableCell className="fs-num text-right font-bold">{row.rank}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Crest name={row.name} src={null} />
                    <span className="font-bold text-ink">{row.name}</span>
                  </span>
                </TableCell>
                <TableCell className="fs-num text-right">{formatRecord(row)}</TableCell>
                <TableCell className="fs-num text-right">{formatWinPct(row.win_pct)}</TableCell>
                <TableCell className="fs-num text-right">{formatPoints(row.points_for)}</TableCell>
                <TableCell className="fs-num text-right">{formatPoints(row.points_against)}</TableCell>
                {columns.median && <TableCell className="fs-num text-right">{formatRecord(row.median_record)}</TableCell>}
                {columns.second && <TableCell className="fs-num text-right">{formatRecord(row.second_record)}</TableCell>}
                <TableCell>
                  {separator ? (
                    <Badge variant="stroke" className="text-[10px]">
                      {separator}
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-n-3">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-[11px] font-medium text-n-3" data-skip-notes>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] font-medium text-n-3">
        Coin flips are seeded on the league’s schedule seed (<span className="fs-num">{doc.coin_flip_seed}</span>) — the same
        tie always breaks the same way.
      </p>
    </div>
  )
}
