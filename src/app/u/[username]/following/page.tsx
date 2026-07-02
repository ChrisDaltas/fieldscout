import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { ProfileListRow } from '@/components/profile/profile-list-row'
import { Card, CardContent } from '@/components/ui/card'
import { createServerClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ username: string }>
}

interface FollowingProfile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  cred_score: number
  is_pro: boolean
}

async function loadFollowing(username: string) {
  const supabase = await createServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  const { data: rows } = await supabase
    .from('follows')
    .select(
      'following:profiles!follows_following_id_fkey(id, username, display_name, avatar_url, bio, cred_score, is_pro)',
    )
    .eq('follower_id', profile.id)
    .order('created_at', { ascending: false })

  const following = ((rows ?? []) as unknown as Array<{ following: FollowingProfile | null }>)
    .map((r) => r.following)
    .filter((p): p is FollowingProfile => Boolean(p))

  return { profile, following }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params
  return { title: `@${username} is following · FieldScout` }
}

export default async function FollowingPage({ params }: PageProps) {
  const { username } = await params
  const data = await loadFollowing(username)
  if (!data) notFound()
  const { profile, following } = data

  return (
    <GuestShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link
            href={`/u/${profile.username}`}
            className="text-xs text-text-secondary hover:text-foreground"
          >
            ← {profile.display_name ?? `@${profile.username}`}
          </Link>
          <h1 className="text-2xl font-bold">Following</h1>
          <p className="text-sm text-text-secondary">
            Following {following.length} user{following.length === 1 ? '' : 's'}
          </p>
        </header>

        {following.length === 0 ? (
          <Card className="border-bg-elevated-2 bg-bg-elevated">
            <CardContent className="p-6 text-center text-sm text-text-secondary">
              Not following anyone yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {following.map((p) => (
              <li key={p.id}>
                <ProfileListRow
                  username={p.username}
                  displayName={p.display_name}
                  avatarUrl={p.avatar_url}
                  bio={p.bio}
                  credScore={p.cred_score}
                  isPro={p.is_pro}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </GuestShell>
  )
}
