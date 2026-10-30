import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { FollowButton } from '@/components/explore/follow-button'
import { GuestShell } from '@/components/layout/guest-shell'
import { ProfileHeader } from '@/components/profile/profile-header'
import { ProfileStats } from '@/components/profile/profile-stats'
import { PublicListCard } from '@/components/lists/public-list-card'
import { PhoneHandoff } from '@/components/shared/phone-handoff'
import { Button } from '@/components/ui/button'
import { appProfileHref, personHandoff } from '@/components/shared/username-link-ops'
import { credOrStart } from '@/lib/cred-tiers'
import { featureFlags } from '@/lib/feature-flags'
import { createServerClient } from '@/lib/supabase/server'

/**
 * A person's public profile — `/u/[username]`, server-rendered for search
 * engines and signed-out visitors (CLAUDE.md: public pages are SSR).
 *
 * **Signed in, someone else's profile, Community on** (plan C6): handed into
 * the app on EITHER layout — the same profile inside the app shell
 * (`personHandoff` → `/app/u/<name>`), with Follow and Share. A server
 * redirect before the lists are read, so the public page never flashes and
 * Back doesn't return to it. On a phone that is the phone screen
 * `PhoneHandoff` opened before C6.
 *
 * **Otherwise this page stays:** for search engines and signed-out
 * visitors, for the person themselves (their "View public profile" — what a
 * stranger sees), and for everyone while Community is off. A signed-in phone
 * is still handed to its phone screen by `PhoneHandoff` (audit profile-1), as
 * before. With Community on, a signed-out visitor gets Follow in the header:
 * it sends them to sign in, then back here — and so into the app. The person
 * themselves never gets it.
 */

interface PageProps {
  params: Promise<{ username: string }>
}

/** The person and who is looking — all `generateMetadata` needs, and all
 *  the hand-off into the app needs, before the lists are read. */
async function loadPerson(username: string) {
  const supabase = await createServerClient()

  // A failed read throws (the segment's error.tsx says it couldn't load) —
  // never a false "User not found" or an empty profile (plan C4, S13).
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'id, username, avatar_url, bio, cred_score, is_pro, follower_count, following_count',
    )
    .eq('username', username)
    .maybeSingle()
  if (profileError) throw new Error(`Couldn't load the profile: ${profileError.message}`)

  if (!profile) return null
  return { supabase, profile }
}

type Person = NonNullable<Awaited<ReturnType<typeof loadPerson>>>

async function loadLists({ supabase, profile }: Person) {
  // Public lists: visible only to non-owners (the user's own /app/profile page
  // hides their lists per spec). Even when the owner is signed in viewing
  // their own /u/[username] page, we still show lists so they see what
  // visitors see.
  const { data: lists, error: listsError } = await supabase
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
  if (listsError) throw new Error(`Couldn't load the profile's lists: ${listsError.message}`)

  return lists ?? []
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params
  const data = await loadPerson(username)
  if (!data) return { title: 'User not found' }
  const { profile } = data
  const handle = `@${profile.username}`
  return {
    title: `${handle} · FieldScout`,
    description:
      profile.bio ?? `${handle}'s lists on FieldScout.`,
  }
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params
  const person = await loadPerson(username)
  if (!person) notFound()
  const { profile } = person

  // Someone signed in opening someone else's profile while Community is on:
  // into the app, on either layout (plan C6). Outside any try — `redirect`
  // throws to do its work.
  const {
    data: { user },
  } = await person.supabase.auth.getUser()
  const handoff = personHandoff({
    communityOn: featureFlags.community,
    viewerId: user?.id ?? null,
    personId: profile.id,
    username: profile.username,
  })
  if (handoff) redirect(handoff)

  const lists = await loadLists(person)

  return (
    <GuestShell>
      {/* A signed-in phone opens this as its phone screen, in the app. */}
      <PhoneHandoff to={appProfileHref(profile.username)} />
      <div className="mx-auto flex max-w-[833px] flex-col gap-6">
        <ProfileHeader
          username={profile.username}
          bio={profile.bio}
          avatarUrl={profile.avatar_url}
          isPro={profile.is_pro}
          credScore={credOrStart(profile.cred_score)}
          followerCount={profile.follower_count}
          followingCount={profile.following_count}
          isOwn={false}
          // Follow (plan C6) — with Community, where following someone shows
          // you their lists — for a signed-out visitor only: it asks them to
          // sign in, then comes back here and so into the app. Anyone else
          // signed in was handed into the app above, so a signed-in viewer
          // here is the person themselves ("View public profile"), who can't
          // follow themselves. Decided on the server (it already knows the
          // viewer), never left to FollowButton's own check, which only runs
          // once the browser has the session — the server render would
          // otherwise offer Follow-yourself for a moment ("Prevent, don't
          // refuse").
          actions={
            featureFlags.community && !user ? <FollowButton userId={profile.id} size="md" /> : null
          }
        />

        <ProfileStats
          credScore={credOrStart(profile.cred_score)}
          followerCount={profile.follower_count}
          followingCount={profile.following_count}
        />

        <section>
          <div className="mb-[9px] flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">
              Public lists
            </h2>
            {/* The public big board is release-gated out of the 2026 go-live
                scope — hide its entry point rather than 404 a visitor. */}
            {featureFlags.bigBoard && (
              <Button asChild variant="stroke" size="sm">
                <Link href={`/u/${profile.username}/big-board`}>
                  View big board
                </Link>
              </Button>
            )}
          </div>
          {lists.length === 0 ? (
            <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
              <h3 className="text-h6 text-ink">No public lists yet</h3>
              <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-n-6">
                Public lists @{profile.username} publishes will show up here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
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
