import Link from 'next/link'

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
      <header className="mb-4">
        <h1 className="text-h4">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-[11px] font-semibold text-n-3">
            {subtitle}
          </p>
        )}
      </header>

      {weekNav}

      {players.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <h2 className="text-h5">No rankings yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-n-3">
            {emptyMessage}
          </p>
        </div>
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
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {weeks.map((w) => {
        const active = w === currentSelected
        return (
          <Link
            key={w}
            href={`/u/${username}/big-board/week/${w}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'fs-num inline-flex h-btn-sm min-w-[26px] items-center justify-center rounded-sm border border-ink px-2 text-[11px] font-bold leading-none transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'bg-white text-ink hover:bg-n-4',
            )}
          >
            {w}
          </Link>
        )
      })}
    </div>
  )
}
