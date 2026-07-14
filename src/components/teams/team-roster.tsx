'use client'

import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

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
 * Fantasy-relevant roster for an NFL team page — the Field Scout stat table:
 * 11px bold header over an ink rule, n-4 hairlines, mono numerals right.
 * Player names open the mini player card. Rows arrive ADP-sorted from the
 * page query.
 */
export function TeamRoster({ players }: TeamRosterProps) {
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  if (players.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <p className="text-h5 text-ink">No players found</p>
        <p className="max-w-md text-[13px] font-medium text-n-3">
          No fantasy-relevant players on this roster yet.
        </p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <Table>
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
                <TableCell className="fs-num text-right text-[12px] font-semibold text-n-3">
                  {player.jersey_number ?? '—'}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2.5">
                    <Avatar className="h-6 w-6">
                      {player.headshot_url && (
                        <AvatarImage
                          src={player.headshot_url}
                          alt={player.full_name}
                          className="object-cover object-top"
                        />
                      )}
                      <AvatarFallback className="text-[9px]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      type="button"
                      onClick={() => openPlayer(player.id)}
                      className="min-w-0 truncate text-left font-extrabold text-ink hover:underline hover:decoration-2 hover:underline-offset-2 focus:outline-none focus-visible:underline"
                    >
                      {player.full_name}
                    </button>
                  </span>
                </TableCell>
                <TableCell>
                  <PositionBadge position={player.position} size="sm" />
                </TableCell>
                <TableCell className="fs-num text-right font-bold">
                  {player.adp != null ? Number(player.adp).toFixed(1) : '—'}
                </TableCell>
                <TableCell className="fs-num text-right font-bold">
                  {player.bye_week ?? '—'}
                </TableCell>
                <TableCell>
                  {injured ? (
                    <span className="inline-flex rounded-sm border border-negative bg-negative-soft px-1 py-px text-[10px] font-bold leading-tight text-negative-strong">
                      {player.status}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-n-3">
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
