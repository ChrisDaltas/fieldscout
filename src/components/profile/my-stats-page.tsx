'use client'

import Link from 'next/link'

import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'
import { ProfileHeader } from '@/components/profile/profile-header'
import { ProfileStats } from '@/components/profile/profile-stats'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { RankingHistoryCard } from '@/components/stats/ranking-history-card'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { featureFlags } from '@/lib/feature-flags'

/**
 * My stats — how the user's profile performs (package screen 09). The shell
 * PageHeader owns the page title; edit/share actions live there. Content:
 * profile header, real stat tiles (cred / tier / followers / following),
 * cred progress bar, accuracy placeholders, ranking history — in the v7
 * Profile language (grey tiles, plain sections, thin pill bars).
 */
export function MyStatsPage() {
  const { profile, isLoading } = useAuth()

  if (isLoading) {
    return (
      <>
        <PageHeader title="My stats" />
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-[15px]">
            <Skeleton className="h-[65px] w-[65px] shrink-0 rounded-full bg-surface-control" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-6 w-40 rounded-md bg-surface-control" />
              <Skeleton className="h-3 w-56 rounded-md bg-surface-control" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Skeleton className="h-[78px] rounded-2xl bg-surface-control" />
            <Skeleton className="h-[78px] rounded-2xl bg-surface-control" />
            <Skeleton className="h-[78px] rounded-2xl bg-surface-control" />
            <Skeleton className="h-[78px] rounded-2xl bg-surface-control" />
          </div>
          <Skeleton className="h-40 w-full rounded-2xl bg-surface-control" />
        </div>
      </>
    )
  }

  if (!profile) {
    return (
      <>
        <PageHeader title="My stats" />
        <div className="mx-auto max-w-2xl rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
          <h2 className="text-h6 text-ink">Profile unavailable</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-negative-strong">
            We couldn&apos;t load your profile. Refresh to try again.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My stats"
        actions={
          <>
            <Button asChild variant="stroke" size="md">
              <Link href="/app/settings/profile">
                <Icon name="edit" />
                Edit profile
              </Link>
            </Button>
            <Button asChild variant="stroke" size="md">
              <Link href={userProfileHref(profile.username)}>
                <Icon name="external-link" />
                View public profile
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <ProfileHeader
          username={profile.username}
          bio={profile.bio}
          avatarUrl={profile.avatar_url}
          isPro={profile.is_pro ?? false}
          credScore={profile.cred_score ?? 0}
          followerCount={profile.follower_count ?? 0}
          followingCount={profile.following_count ?? 0}
          isOwn
        />

        {/* Ranking history is entirely big-board content (its rows and both
            of its links point there), so it hides with the big board's
            release gate — and My stats goes single-column rather than
            leaving an empty context column. */}
        {featureFlags.bigBoard ? (
          <TwoColumnLayout
            main={
              <ProfileStats
                credScore={profile.cred_score ?? 0}
                followerCount={profile.follower_count ?? 0}
                followingCount={profile.following_count ?? 0}
                showInfoPopover
              />
            }
            aside={<RankingHistoryCard />}
          />
        ) : (
          <ProfileStats
            credScore={profile.cred_score ?? 0}
            followerCount={profile.follower_count ?? 0}
            followingCount={profile.following_count ?? 0}
            showInfoPopover
          />
        )}
      </div>
    </>
  )
}
