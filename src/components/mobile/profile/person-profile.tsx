'use client'

import { FollowButton } from '@/components/explore/follow-button'
import { postHref } from '@/components/mobile/community/community-ops'
import { personAvatarClass, personListSub, personProfileParent } from '@/components/mobile/profile/person-profile-ops'
import { CredCardView, PreviewBody, PreviewRow, StatCard } from '@/components/mobile/profile/profile-parts'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { M_ICON } from '@/components/mobile/ui/m-icon'
import { MobileScreen, RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { phoneFollowsHref } from '@/components/shared/username-link-ops'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { usePersonProfile, type PersonProfileData } from '@/hooks/use-person-profile'
import { credOrStart } from '@/lib/cred-tiers'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

/**
 * A person's profile on the phone (`/app/u/[username]`) — anyone's, your own
 * included (your @handle on Profile opens it: your public profile, as others
 * see it). What the public page (`/u/[username]`) shows, in the Profile
 * tab's language (`profile-parts.tsx`), inside the app: the dock stays, the
 * phone's light/dark applies, and Back goes to where you came from (#27) —
 * else Profile (yours) or Community / Home (anyone else's).
 *
 *  - Avatar, the @handle (the page's heading — FieldScout keeps no other
 *    name, ruling 2026-08-05) and Follow (Community's phone pill; nothing on
 *    your own). The bio under it, as on Profile.
 *  - Followers · Following: the counts, each opening that list.
 *  - The Cred card: Scout tier, cred and the bar to the next tier.
 *  - Public lists, newest first (the public page's 20), each opening the
 *    list where a phone opens a public list (Community's list page while
 *    Community is on, else the List view).
 *
 * Left out, as the Profile tab leaves them out: the "Ranking accuracy"
 * placeholders (no grading exists) and the Pro badge (Pro is on hold). The
 * public big board's door is left out too: that page is switched off for
 * launch and has no phone screen.
 */
export function MobilePersonProfile({ username }: { username: string }) {
  const { user, profile: me } = useAuth()
  const goBack = useGoBack()
  const person = usePersonProfile(username)
  const data = person.data
  const isOwn = me?.username === username || (Boolean(user) && data?.profile.id === user?.id)

  const header = (
    <div className="flex h-[52px] items-center px-3">
      <RoundNavButton kind="back" label="Back" onClick={() => goBack(personProfileParent(isOwn, featureFlags.community))} />
    </div>
  )

  return (
    <MobileScreen header={header}>
      <div className="px-4 pb-6">
        {person.isPending ? (
          <PersonSkeleton />
        ) : person.isError ? (
          <PersonProblem copy="We couldn’t load this profile." onRetry={() => void person.refetch()} />
        ) : data === null || data === undefined ? (
          <PersonNotFound />
        ) : (
          <PersonBody data={data} isOwn={isOwn} />
        )}
      </div>
    </MobileScreen>
  )
}

function PersonBody({ data, isOwn }: { data: PersonProfileData; isOwn: boolean }) {
  const { profile, lists } = data
  const about = profile.bio?.trim()
  return (
    <>
      <div className="mt-1 flex items-center gap-[14px]">
        <UserAvatar
          src={profile.avatar_url}
          name={profile.username}
          className="size-16 flex-none"
          fallbackClassName={cn(personAvatarClass(isOwn, profile.id), 'text-[24px] font-semibold text-white')}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-[22px] font-bold tracking-[-0.02em]">@{profile.username}</h1>
          {isOwn && <span className="text-[13px] font-medium text-m-t3">Your public profile</span>}
        </div>
        {!isOwn && <FollowButton userId={profile.id} look="phone" />}
      </div>

      {about && (
        <p
          className="mt-3 whitespace-pre-line break-words text-[13px] font-medium leading-[1.45] text-m-t2 text-pretty"
          data-profile-bio
        >
          {about}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatCard
          value={profile.follower_count.toLocaleString('en-US')}
          label="Followers"
          href={phoneFollowsHref(profile.username, 'followers')}
        />
        <StatCard
          value={profile.following_count.toLocaleString('en-US')}
          label="Following"
          href={phoneFollowsHref(profile.username, 'following')}
        />
      </div>

      <CredCardView credScore={credOrStart(profile.cred_score)} />

      <h2 className="mt-5 text-[17px] font-semibold leading-normal tracking-[-0.01em]">Public lists</h2>
      <PreviewBody
        loading={false}
        error={null}
        emptyCopy={isOwn ? 'You haven’t shared any lists yet' : 'No public lists yet'}
        count={lists.length}
      >
        {lists.map((l) => (
          <PreviewRow
            key={l.id}
            href={postHref(l.id, featureFlags.community)}
            iconPath={M_ICON.lists}
            title={l.title}
            sub={personListSub(l)}
          />
        ))}
      </PreviewBody>
    </>
  )
}

/** Nobody has this username — said plainly, never an empty-looking profile. */
export function PersonNotFound() {
  return (
    <div className="flex flex-col items-center gap-1.5 py-16 text-center" data-person-not-found>
      <p className="text-[15px] font-semibold">We can’t find this person</p>
      <p className="text-[13px] font-medium text-m-t3">They may have changed their username.</p>
    </div>
  )
}

/** A read that failed: what happened, and a way to try again. */
export function PersonProblem({ copy, onRetry }: { copy: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
      <p className="text-[13px] font-medium text-m-t3">{copy}</p>
      <button type="button" onClick={onRetry} className="text-[13px] font-semibold text-accent">
        Try again
      </button>
    </div>
  )
}

function PersonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mt-1 flex items-center gap-[14px]">
        <span className="size-16 flex-none rounded-full bg-m-b1" />
        <span className="h-[22px] w-36 rounded-md bg-m-b1" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="h-[56px] rounded-[14px] bg-m-b1" />
        <span className="h-[56px] rounded-[14px] bg-m-b1" />
      </div>
      {/* The Cred card's height. */}
      <span className="mt-2 block h-[77px] rounded-[14px] bg-m-b1" />
      <PreviewBody loading error={null} emptyCopy="" count={0}>
        {null}
      </PreviewBody>
    </div>
  )
}
