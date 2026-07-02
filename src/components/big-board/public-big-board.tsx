import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import { PlayerCard } from '@/components/players/player-card'
import { cn } from '@/lib/utils'

export interface PublicBigBoardPlayer {
  player_id: string
  position: number
  full_name: string
  position_code: string
  team: string | null
  headshot_url: string | null
  projected_pts?: number | null
}

interface PublicBigBoardProps {
  title: string
  subtitle?: string
  players: PublicBigBoardPlayer[]
  emptyMessage?: string
  /** Optional week-strip nav — only used on weekly pages. */
  weekNav?: React.ReactNode
}

/**
 * Server-rendered, read-only Big Board view for /u/[username]/big-board and
 * its weekly variant. Pure presentation — no fetching, no client JS for the
 * grid itself, so the page is fully static-renderable for SEO.
 */
export function PublicBigBoard({
  title,
  subtitle,
  players,
  emptyMessage = 'This Big Board is empty.',
  weekNav,
}: PublicBigBoardProps) {
  return (
    <section>
      <header className="mb-4 space-y-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-xs text-text-tertiary">{subtitle}</p>
        )}
      </header>

      {weekNav}

      {players.length === 0 ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-8 text-center text-sm text-text-secondary">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
          {players.map((p, i) => (
            <PublicCard key={p.player_id} rank={i + 1} player={p} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PublicCard({
  rank,
  player,
}: {
  rank: number
  player: PublicBigBoardPlayer
}) {
  return (
    <li>
      <PlayerCard
        rank={rank}
        player={{
          id: player.player_id,
          full_name: player.full_name,
          position: player.position_code,
          team: player.team,
          headshot_url: player.headshot_url,
        }}
        projectedPts={player.projected_pts ?? null}
      />
    </li>
  )
}

interface PublicWeekStripProps {
  username: string
  currentSelected: number
}

export function PublicWeekStrip({
  username,
  currentSelected,
}: PublicWeekStripProps) {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1)
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {weeks.map((w) => {
        const active = w === currentSelected
        return (
          <Link
            key={w}
            href={`/u/${username}/big-board/week/${w}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
            )}
          >
            {w}
          </Link>
        )
      })}
    </div>
  )
}
