'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { BuilderPlayer } from '@/components/lists/builder/types'
import { PositionBadge } from '@/components/players/position-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

interface DraftQueueCardProps {
  queue: BuilderPlayer[]
  onRemove: (playerId: string) => void
}

function initialsFor(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
}

/** Your queue — ordinal, headshot, position, name, projection. Queue order
 *  is local state owned by the room. */
// TODO(live-draft): persist the queue to the draft service so it survives
// reloads and can auto-pick when the clock runs out.
export function DraftQueueCard({ queue, onRemove }: DraftQueueCardProps) {
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your queue</CardTitle>
      </CardHeader>
      <CardContent>
        {queue.length === 0 ? (
          <p className="text-[11px] font-medium text-n-3">
            Queue players from best available so a plan is ready when the
            clock hits you.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {queue.map((player, i) => (
              <div key={player.id} className="group flex items-center gap-2">
                <span className="fs-num w-4 shrink-0 text-[11px] font-semibold text-n-3">
                  {i + 1}
                </span>
                <Avatar className="h-6 w-6 shrink-0">
                  {player.headshot_url && (
                    <AvatarImage
                      src={player.headshot_url}
                      alt={player.full_name}
                      className="h-full w-full object-cover object-top"
                    />
                  )}
                  <AvatarFallback className="text-[9px]">
                    {initialsFor(player.full_name)}
                  </AvatarFallback>
                </Avatar>
                <PositionBadge
                  position={player.position}
                  size="sm"
                  className="shrink-0"
                />
                <button
                  type="button"
                  onClick={() => openPlayer(player.id)}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left text-[11px] font-extrabold leading-tight hover:underline hover:decoration-2 hover:underline-offset-2 focus:outline-none focus-visible:underline"
                >
                  {player.full_name}
                </button>
                <span className="fs-num shrink-0 text-[10px] font-semibold text-n-3">
                  Proj{' '}
                  {player.projected_pts != null
                    ? player.projected_pts.toFixed(1)
                    : '—'}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(player.id)}
                  aria-label={`Remove ${player.full_name} from queue`}
                  className="shrink-0 rounded-sm p-0.5 text-n-3 opacity-0 transition-all hover:bg-negative-soft hover:text-negative-strong focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
