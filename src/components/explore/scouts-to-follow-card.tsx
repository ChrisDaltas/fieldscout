'use client'

import { FollowButton } from '@/components/explore/follow-button'
import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { UsernameLink } from '@/components/shared/username-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { followersLabel, useScoutsToFollow } from '@/hooks/use-scouts-to-follow'

/**
 * "Scouts to follow" (package screen 08's right-column leaderboard, renamed
 * — plan C4): people with public lists, most followed first
 * (`useScoutsToFollow`, the phone shelf's read). Each row says how many
 * followers they have; your own row swaps Follow for the blue "You" chip.
 * A failed read says so, with Try again — never "nobody here".
 */
export function ScoutsToFollowCard() {
  const scouts = useScoutsToFollow()
  const { user } = useAuth()

  return (
    <CollapsibleCard title="Scouts to follow">
      {scouts.isPending ? (
        <div className="space-y-2 p-[13px]" aria-busy="true" aria-label="Loading scouts to follow">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md bg-surface-control" />
          ))}
        </div>
      ) : scouts.isError ? (
        <div className="flex flex-col items-center gap-2 p-[19px] text-center">
          <p className="text-[11px] font-semibold text-negative-strong">Couldn&apos;t load scouts to follow.</p>
          <Button variant="stroke" size="sm" onClick={() => void scouts.refetch()} disabled={scouts.isFetching}>
            {scouts.isFetching ? 'Loading…' : 'Try again'}
          </Button>
        </div>
      ) : scouts.data.length === 0 ? (
        <p className="p-[19px] text-center text-[11px] font-medium text-n-6">
          No scouts to follow yet.
        </p>
      ) : (
        <div className="divide-y divide-n-4">
          {scouts.data.map((scout, i) => {
            const isYou = scout.id === user?.id
            return (
              <div
                key={scout.id}
                className="relative flex items-center gap-2.5 px-[13px] py-2 transition-colors hover:bg-surface-sunken"
                data-scout
              >
                <span className="fs-num w-4 shrink-0 text-[11px] font-bold text-n-6">
                  {i + 1}
                </span>
                <UserAvatar
                  src={scout.avatar_url}
                  name={scout.username}
                  className="h-7 w-7 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <UsernameLink
                    username={scout.username}
                    className="block truncate text-[11px] font-bold text-ink after:absolute after:inset-0"
                  />
                  <div className="fs-num text-[10px] font-semibold text-n-6">
                    {followersLabel(scout.followers)}
                  </div>
                </div>
                {isYou ? (
                  <Badge variant="accent" className="relative z-10 shrink-0">
                    You
                  </Badge>
                ) : (
                  <FollowButton userId={scout.id} className="relative z-10 shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </CollapsibleCard>
  )
}
