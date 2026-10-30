import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PhoneHandoff } from '@/components/shared/phone-handoff'
import { PersonFollowsList } from '@/components/profile/person-follows-list'
import { featureFlags } from '@/lib/feature-flags'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'
import { createServerClient } from '@/lib/supabase/server'
import { appFollowsHref, personHandoff, userProfileHref } from '@/components/shared/username-link-ops'

interface PageProps {
  params: Promise<{ username: string }>
}

interface FollowingProfile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number | null
  is_pro: boolean
}

async function loadFollowing(username: string) {
  const supabase = await createServerClient()

  // A failed read throws (the segment's error.tsx says it couldn't load) —
  // never a false 404 or "Not following anyone yet" (plan C4, S13).
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle()
  if (error) throw new Error(`Couldn't load the profile: ${error.message}`)
  if (!profile) return null

  // Signed in, someone else's Following, Community on: into the app, on
  // either layout (plan C6) — before the rows are read. Outside any try:
  // `redirect` throws to do its work.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const handoff = personHandoff({
    communityOn: featureFlags.community,
    viewerId: user?.id ?? null,
    personId: profile.id,
    username: profile.username,
    kind: 'following',
  })
  if (handoff) redirect(handoff)

  // Every row, past PostgREST's 1000-row cap (`pageAll`, with an exact
  // count) — the same read as the phone's screen (`usePersonFollows`). The
  // other id is unique within the filter, so it ends the sort.
  const rows = await pageAll<{ following: FollowingProfile | null }>((from, to) =>
    supabase
      .from('follows')
      .select('following:profiles!follows_following_id_fkey(id, username, avatar_url, bio, cred_score, is_pro)', {
        count: 'exact',
      })
      .eq('follower_id', profile.id)
      .order('created_at', { ascending: false })
      .order('following_id', { ascending: true })
      .range(from, to) as unknown as PageResponse<{ following: FollowingProfile | null }>,
  )

  const following = rows
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
      {/* A signed-in phone opens this as its phone screen, in the app. */}
      <PhoneHandoff to={appFollowsHref(profile.username, 'following')} />
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

        <PersonFollowsList username={profile.username} kind="following" people={following} />
      </div>
    </GuestShell>
  )
}
