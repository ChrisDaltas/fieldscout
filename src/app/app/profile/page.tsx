'use client'

import Link from 'next/link'

import { PageHeader } from '@/components/layout/app-header'
import { TwoColumnLayout } from '@/components/layout/two-column-layout'
import { ProfileHeader } from '@/components/profile/profile-header'
import { ProfileStats } from '@/components/profile/profile-stats'
import { RankingHistoryCard } from '@/components/stats/ranking-history-card'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { featureFlags } from '@/lib/feature-flags'

/**
 * My stats — how the user's profile performs (package screen 09). The shell
 * PageHeader owns the page title; edit/share actions live there. Content:
 * profile hero card, real stat tiles (cred / tier / followers / following),
 * cred progress bar, accuracy placeholders, ranking history.
 */
export default function ProfilePage() {
  const { profile, isLoading } = useAuth()

  if (isLoading) {
    return (
      <>
        <PageHeader title="My stats" />
        <div className="space-y-[19px]">
          <Skeleton className="h-28 w-full" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    )
  }

  if (!profile) {
    return (
      <>
        <PageHeader title="My stats" />
        <div className="mx-auto max-w-2xl rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <h2 className="text-h5">Profile unavailable</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-negative-strong">
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
            <Button asChild variant="blue" size="md">
              <Link href={`/u/${profile.username}`}>
                <Icon name="external-link" />
                View public profile
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-[19px]">
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
