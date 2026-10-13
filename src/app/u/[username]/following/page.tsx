import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { ProfileListRow } from '@/components/profile/profile-list-row'
import { createServerClient } from '@/lib/supabase/server'
import { userProfileHref } from '@/components/shared/username-link-ops'

interface PageProps {
  params: Promise<{ username: string }>
}

interface FollowingProfile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number
  is_pro: boolean
}

async function loadFollowing(username: string) {
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
      'following:profiles!follows_following_id_fkey(id, username, avatar_url, bio, cred_score, is_pro)',
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
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <header>
          <Link
            href={userProfileHref(profile.username)}
            className="text-[11px] font-semibold text-n-3 transition-colors hover:text-ink"
          >
            ← @{profile.username}
          </Link>
          <h1 className="mt-2 text-h3 text-ink">Following</h1>
          <p className="mt-1 text-[11px] font-semibold text-n-3">
            Following <span className="fs-num">{following.length}</span> user
            {following.length === 1 ? '' : 's'}
          </p>
        </header>

        {following.length === 0 ? (
          <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
            <h2 className="text-h6 text-ink">Not following anyone yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-n-6">
              Scouts @{profile.username} follows will show up here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
            <ul className="divide-y divide-n-4">
              {following.map((p) => (
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
