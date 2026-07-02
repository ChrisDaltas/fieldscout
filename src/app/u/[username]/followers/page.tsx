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

interface FollowerProfile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  cred_score: number
  is_pro: boolean
}

async function loadFollowers(username: string) {
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
      'follower:profiles!follows_follower_id_fkey(id, username, display_name, avatar_url, bio, cred_score, is_pro)',
    )
    .eq('following_id', profile.id)
    .order('created_at', { ascending: false })

  const followers = ((rows ?? []) as unknown as Array<{ follower: FollowerProfile | null }>)
    .map((r) => r.follower)
    .filter((p): p is FollowerProfile => Boolean(p))

  return { profile, followers }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params
  return { title: `Followers of @${username} · FieldScout` }
}

export default async function FollowersPage({ params }: PageProps) {
  const { username } = await params
  const data = await loadFollowers(username)
  if (!data) notFound()
  const { profile, followers } = data

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
          <h1 className="text-2xl font-bold">Followers</h1>
          <p className="text-sm text-text-secondary">
            {followers.length} follower{followers.length === 1 ? '' : 's'}
          </p>
        </header>

        {followers.length === 0 ? (
          <Card className="border-bg-elevated-2 bg-bg-elevated">
            <CardContent className="p-6 text-center text-sm text-text-secondary">
              No followers yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {followers.map((p) => (
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
