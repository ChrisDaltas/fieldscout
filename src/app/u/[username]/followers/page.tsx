import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { ProfileListRow } from '@/components/profile/profile-list-row'
import { createServerClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ username: string }>
}

interface FollowerProfile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number
  is_pro: boolean
}

async function loadFollowers(username: string) {
  const supabase = await createServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  const { data: rows } = await supabase
    .from('follows')
    .select(
      'follower:profiles!follows_follower_id_fkey(id, username, avatar_url, bio, cred_score, is_pro)',
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
      <div className="mx-auto max-w-2xl space-y-[19px]">
        <header>
          <Link
            href={`/u/${profile.username}`}
            className="text-[11px] font-bold text-n-3 transition-colors hover:text-ink hover:underline"
          >
            ← @{profile.username}
          </Link>
          <h1 className="mt-1 text-h4">Followers</h1>
          <p className="mt-0.5 text-[13px] font-bold text-n-3">
            <span className="fs-num">{followers.length}</span> follower
            {followers.length === 1 ? '' : 's'}
          </p>
        </header>

        {followers.length === 0 ? (
          <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
            <h2 className="text-h5">No followers yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-n-3">
              When scouts follow @{profile.username}, they show up here.
            </p>
          </div>
        ) : (
          <div className="rounded-sm border border-ink bg-white">
            <ul className="divide-y divide-n-4">
              {followers.map((p) => (
                <li key={p.id}>
                  <ProfileListRow
                    userId={p.id}
                    username={p.username}
                    avatarUrl={p.avatar_url}
                    bio={p.bio}
                    credScore={p.cred_score}
                    isPro={p.is_pro}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </GuestShell>
  )
}
