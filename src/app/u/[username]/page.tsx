import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { ProfileHeader } from '@/components/profile/profile-header'
import { ProfileStats } from '@/components/profile/profile-stats'
import { PublicListCard } from '@/components/lists/public-list-card'
import { Card, CardContent } from '@/components/ui/card'
import { createServerClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ username: string }>
}

async function loadProfile(username: string) {
  const supabase = await createServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, avatar_url, bio, cred_score, is_pro, follower_count, following_count',
    )
    .eq('username', username)
    .maybeSingle()

  if (!profile) return null

  const { data: viewer } = await supabase.auth.getUser()
  const isOwn = viewer.user?.id === profile.id

  // Public lists: visible only to non-owners (the user's own /app/profile page
  // hides their lists per spec). Even when the owner is signed in viewing
  // their own /u/[username] page, we still show lists so they see what
  // visitors see.
  const { data: lists } = await supabase
    .from('lists')
    .select(
      'id, owner_id, title, slug, description, position_filter, like_count, view_count, player_count, updated_at',
    )
    .eq('owner_id', profile.id)
    .eq('is_private', false)
    .eq('is_big_board', false)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(20)

  return { profile, isOwn, lists: lists ?? [] }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params
  const data = await loadProfile(username)
  if (!data) return { title: 'User not found' }
  const { profile } = data
  const handle = profile.display_name ?? `@${profile.username}`
  return {
    title: `${handle} · FieldScout`,
    description:
      profile.bio ?? `${handle}'s rankings, accuracy, and lists on FieldScout.`,
  }
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params
  const data = await loadProfile(username)
  if (!data) notFound()

  const { profile, lists } = data

  return (
    <GuestShell>
      <div className="mx-auto max-w-4xl space-y-8">
        <ProfileHeader
          username={profile.username}
          displayName={profile.display_name}
          bio={profile.bio}
          avatarUrl={profile.avatar_url}
          isPro={profile.is_pro}
          credScore={profile.cred_score}
          followerCount={profile.follower_count}
          followingCount={profile.following_count}
          isOwn={false}
        />

        <ProfileStats credScore={profile.cred_score} />

        <section>
          <h2 className="mb-3 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wider text-text-tertiary">
            <span>Public lists</span>
            <Link
              href={`/u/${profile.username}/big-board`}
              className="text-xs font-medium normal-case text-foreground hover:underline"
            >
              View Big Board →
            </Link>
          </h2>
          {lists.length === 0 ? (
            <Card className="border-bg-elevated-2 bg-bg-elevated">
              <CardContent className="p-6 text-center text-sm text-text-secondary">
                No public lists yet.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {lists.map((list) => (
                <li key={list.id}>
                  <PublicListCard
                    href={`/u/${profile.username}/lists/${list.slug}`}
                    title={list.title}
                    description={list.description}
                    positionFilter={list.position_filter}
                    playerCount={list.player_count}
                    likeCount={list.like_count}
                    updatedAt={list.updated_at}
                    owner={{
                      username: profile.username,
                      display_name: profile.display_name,
                      avatar_url: profile.avatar_url,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </GuestShell>
  )
}
