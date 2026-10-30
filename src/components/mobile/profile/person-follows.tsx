'use client'

import { useRouter } from 'next/navigation'

import { FollowButton } from '@/components/explore/follow-button'
import { AuthorAvatar } from '@/components/mobile/community/community-cards'
import { PersonNotFound, PersonProblem } from '@/components/mobile/profile/person-profile'
import { FOLLOWS_KINDS, followRowSub, followsEmptyCopy, followsSegmentLabel } from '@/components/mobile/profile/person-profile-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { UsernameLink } from '@/components/shared/username-link'
import { appFollowsHref, appProfileHref, type PersonFollowsKind } from '@/components/shared/username-link-ops'
import { useAuth } from '@/hooks/use-auth'
import { usePersonFollows } from '@/hooks/use-person-follows'
import { usePersonProfile } from '@/hooks/use-person-profile'
import { credOrStart } from '@/lib/cred-tiers'

/**
 * A person's Followers / Following on the phone (`/app/u/[username]/
 * followers|following`) — the public pages' lists in the phone's language:
 * the page bar names whose lists these are, a Followers | Following switch
 * (with the profile's counts) flips between them in place, and each row is
 * Community's people row: avatar, the @handle opening that person, their
 * cred and bio, and Follow (or "You" on your own row).
 *
 * Back goes to where you came from (#27) — else this person's profile. The
 * switch replaces the page rather than stacking it, so Back from either list
 * is the one step back to the profile.
 */
export function MobilePersonFollows({ username, kind }: { username: string; kind: PersonFollowsKind }) {
  const router = useRouter()
  const goBack = useGoBack()
  const { user, profile: me } = useAuth()
  const follows = usePersonFollows(username, kind)
  // The counts on the switch — the profile read the profile screen shares.
  const person = usePersonProfile(username)
  const counts = person.data
    ? { followers: person.data.profile.follower_count, following: person.data.profile.following_count }
    : null
  const isOwn = me?.username === username

  const header = <MPageBar title={`@${username}`} onBack={() => goBack(appProfileHref(username))} />

  return (
    <MobileScreen header={header}>
      <div className="px-4 pb-6">
        <MSegmented
          label="Followers and following"
          options={FOLLOWS_KINDS.map((k) => ({ value: k.value, label: followsSegmentLabel(k.value, counts ? counts[k.value] : null) }))}
          value={kind}
          onChange={(next) => {
            if (next !== kind) router.replace(appFollowsHref(username, next), { scroll: false })
          }}
          className="mt-3"
          itemClassName="h-8 transition-none"
        />

        {follows.isPending ? (
          <div className="mt-1.5 flex flex-col" aria-busy="true" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 border-b border-m-b2 py-2.5">
                <span className="size-[34px] flex-none rounded-full bg-m-b1" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="h-[14px] w-2/5 rounded-md bg-m-b1" />
                  <span className="h-3 w-3/5 rounded-md bg-m-b1" />
                </span>
              </div>
            ))}
          </div>
        ) : follows.isError ? (
          <PersonProblem
            copy={kind === 'followers' ? 'We couldn’t load the followers.' : 'We couldn’t load who they follow.'}
            onRetry={() => void follows.refetch()}
          />
        ) : follows.data === null || follows.data === undefined ? (
          <PersonNotFound />
        ) : follows.data.people.length === 0 ? (
          <p className="py-9 text-center text-[13px] font-medium text-m-t3" data-follows-empty>
            {followsEmptyCopy(kind, isOwn)}
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col">
            {follows.data.people.map((p) => (
              <li key={p.id} className="relative flex items-center gap-3 border-b border-m-b2 py-2.5" data-follow-row>
                <AuthorAvatar
                  author={{ profileId: p.id, username: p.username, avatarUrl: p.avatar_url, followers: null, isPersona: false }}
                  size={34}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  {/* The handle opens that person; stretched over the row so
                      the whole row does, with Follow above it. */}
                  <UsernameLink
                    username={p.username}
                    className="truncate text-[14px] font-semibold text-m-t1 after:absolute after:inset-0"
                  />
                  <span className="truncate text-[12px] font-medium text-m-t3">
                    {followRowSub({ cred_score: credOrStart(p.cred_score), bio: p.bio })}
                  </span>
                </span>
                {p.id === user?.id ? (
                  <span className="relative z-10 flex h-[30px] flex-none items-center rounded-pill bg-m-gb px-[14px] text-[12px] font-semibold text-m-tb">
                    You
                  </span>
                ) : (
                  <FollowButton userId={p.id} look="phone" className="relative z-10" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </MobileScreen>
  )
}
