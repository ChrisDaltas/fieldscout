'use client'

import { PlayerRow } from '@/components/players/player-row'
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
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

interface TeamRosterProps {
  players: RosterPlayer[]
}

/**
 * Fantasy-relevant roster for an NFL team detail page, grouped by position.
 * Clicking a player opens the progressive-disclosure player modal.
 */
export function TeamRoster({ players }: TeamRosterProps) {
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  const groups = POSITION_ORDER.map((position) => ({
    position,
    players: players
      .filter((p) => p.position === position)
      .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity)),
  })).filter((g) => g.players.length > 0)

  if (groups.length === 0) {
    return (
      <p className="rounded-md border border-bg-elevated-2 bg-bg-elevated p-8 text-center text-sm text-text-secondary">
        No fantasy-relevant players found for this team.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.position}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {group.position === 'DEF' ? 'Defense' : group.position}
            <span className="ml-2 font-normal normal-case tracking-normal">
              {group.players.length}
            </span>
          </h2>
          <ul className="space-y-0.5 rounded-md border border-bg-elevated-2 bg-bg-elevated p-1">
            {group.players.map((player, i) => (
              <li key={player.id}>
                <PlayerRow
                  rank={i + 1}
                  player={player}
                  showRank={false}
                  onOpen={() => openPlayer(player.id)}
                  trailing={
                    player.adp != null ? (
                      <span className="shrink-0 text-xs text-text-secondary tabular-nums">
                        ADP {Number(player.adp).toFixed(1)}
                      </span>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
