'use client'

import { PositionBadge } from '@/components/players/position-badge'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOpenPlayer } from '@/hooks/use-open-player'

export interface RosterPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  jersey_number: number | null
  adp: number | null
  bye_week: number | null
}

const INJURY_STATUSES = new Set([
  'Questionable',
  'Doubtful',
  'Out',
  'IR',
  'PUP',
  'Suspended',
])

interface TeamRosterProps {
  players: RosterPlayer[]
}

/**
 * Fantasy-relevant roster for an NFL team page — the v7 stat table: 10px
 * grey header, 11px rows on n-4 hairlines, mono numerals right.
 * Player names open the mini player card. Rows arrive ADP-sorted from the
 * page query.
 */
export function TeamRoster({ players }: TeamRosterProps) {
  const openPlayer = useOpenPlayer()

  if (players.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-1 px-6 py-16 text-center">
        <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">No players found</p>
        <p className="max-w-md text-[11px] font-medium text-n-6">
          No fantasy-relevant players on this roster yet.
        </p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <Table className="text-[11px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">No.</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="w-14">Pos</TableHead>
            <TableHead className="w-16 text-right">ADP</TableHead>
            <TableHead className="w-14 text-right">Bye</TableHead>
            <TableHead className="w-28">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.map((player) => {
            const initials = player.full_name
              .split(' ')
              .map((n) => n[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
            const injured =
              player.status != null &&
              (INJURY_STATUSES.has(player.status) ||
                player.status.toLowerCase().includes('injur'))

            return (
              <TableRow key={player.id}>
                <TableCell className="fs-num text-right text-[11px] font-semibold text-n-6">
                  {player.jersey_number ?? '—'}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2.5">
                    <Avatar className="h-6 w-6">
                      <PlayerAvatarImage player={player} alt={player.full_name} />
                      <AvatarFallback className="text-[9px]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      type="button"
                      onClick={() => openPlayer(player.id)}
                      className="min-w-0 truncate text-left text-[12px] font-semibold text-ink transition-colors hover:text-accent-strong hover:underline focus:outline-none focus-visible:underline"
                    >
                      {player.full_name}
                    </button>
                  </span>
                </TableCell>
                <TableCell>
                  <PositionBadge position={player.position} size="sm" />
                </TableCell>
                <TableCell className="fs-num text-right font-semibold">
                  {player.adp != null ? Number(player.adp).toFixed(1) : '—'}
                </TableCell>
                <TableCell className="fs-num text-right font-semibold">
                  {player.bye_week ?? '—'}
                </TableCell>
                <TableCell>
                  {injured ? (
                    <span className="inline-flex h-[17px] items-center rounded-sm bg-negative-soft px-1 text-[9px] font-bold text-negative-strong">
                      {player.status}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-n-6">
                      {player.status ?? '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
