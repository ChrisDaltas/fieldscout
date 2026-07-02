'use client'

import { ProfileHeader } from '@/components/profile/profile-header'
import { ProfileStats } from '@/components/profile/profile-stats'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'

export default function ProfilePage() {
  const { profile, isLoading } = useAuth()

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading profile…</p>
  }

  if (!profile) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-destructive">
          Profile unavailable.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <ProfileHeader
        username={profile.username}
        displayName={profile.display_name}
        bio={profile.bio}
        avatarUrl={profile.avatar_url}
        isPro={profile.is_pro ?? false}
        credScore={profile.cred_score ?? 0}
        followerCount={profile.follower_count ?? 0}
        followingCount={profile.following_count ?? 0}
        isOwn
      />
      <ProfileStats credScore={profile.cred_score ?? 0} showInfoPopover />
    </div>
  )
}
