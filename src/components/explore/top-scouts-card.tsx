'use client'

import Link from 'next/link'

import { FollowButton } from '@/components/explore/follow-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useTopScouts } from '@/hooks/use-top-scouts'

/**
 * "Top ranked scouts" leaderboard (package screen 08, right column). Ranked
 * by real cred score — no accuracy metric exists yet, so rows read "cred"
 * instead of the mock's "accuracy". The viewer's own row swaps the follow
 * button for the blue "You" chip.
 */
export function TopScoutsCard() {
  const { data: scouts, isLoading } = useTopScouts()
  const { user } = useAuth()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top ranked scouts</CardTitle>
      </CardHeader>

      {isLoading ? (
        <div className="space-y-2 p-[13px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !scouts || scouts.length === 0 ? (
        <p className="p-[19px] text-center text-[11px] font-medium text-n-3">
          No scouts on the board yet.
        </p>
      ) : (
        <div className="divide-y divide-n-4">
          {scouts.map((scout, i) => {
            const isYou = scout.id === user?.id
            return (
              <div
                key={scout.id}
                className="relative flex items-center gap-2.5 px-[13px] py-2 transition-colors hover:bg-n-4/50"
              >
                <span className="fs-num w-4 shrink-0 text-[11px] font-extrabold text-n-3">
                  {i + 1}
                </span>
                <UserAvatar
                  src={scout.avatar_url}
                  name={scout.display_name ?? scout.username}
                  className="h-7 w-7 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${scout.username}`}
                    className="block truncate text-[10px] font-extrabold text-ink after:absolute after:inset-0"
                  >
                    @{scout.username}
                  </Link>
                  <div className="fs-num text-[9px] font-semibold text-n-3">
                    {scout.cred_score.toLocaleString()} cred
                  </div>
                </div>
                {isYou ? (
                  <Badge variant="accent" className="relative z-10 shrink-0">
                    You
                  </Badge>
                ) : (
                  <FollowButton className="relative z-10 shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
