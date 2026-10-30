'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { FollowButton } from '@/components/explore/follow-button'
import { PageHeader } from '@/components/layout/app-header'
import { PublicListCard } from '@/components/lists/public-list-card'
import { inAppListHref } from '@/components/mobile/community/community-ops'
import { FOLLOWS_KINDS, personProfileParent } from '@/components/mobile/profile/person-profile-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { PersonFollowsList } from '@/components/profile/person-follows-list'
import { ProfileHeader } from '@/components/profile/profile-header'
import { StatTile } from '@/components/profile/profile-stats'
import { ShareLinkButton } from '@/components/shared/share-link-button'
import { UsernameLink } from '@/components/shared/username-link'
import {
  appFollowsHref,
  appProfileHref,
  userProfileHref,
  type PersonFollowsKind,
} from '@/components/shared/username-link-ops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { usePersonFollows } from '@/hooks/use-person-follows'
import { usePersonProfile, type PersonProfileData } from '@/hooks/use-person-profile'
import { credOrStart } from '@/lib/cred-tiers'
import { featureFlags } from '@/lib/feature-flags'

/**
 * A person's profile on desktop, inside the app shell — `/app/u/[username]`
 * while Community is on (plan C6; readiness S7a). Every username in the app
 * opens it (`UsernameLink` → `profileHrefFor`), and a signed-in visitor to
 * someone's public page is handed here (`personHandoff`).
 *
 * v7's Profile, with what FieldScout has today:
 *  - the identity row (`ProfileHeader`, the public page's own): avatar,
 *    @handle and tier, the followers · following · cred line, the bio — and
 *    the buttons at the row's end: **Follow** and **Share** on someone
 *    else's, **Edit profile** and **Share** on your own (Share copies the
 *    public profile link, which anyone can open);
 *  - grey tiles: **Followers** and **Following** (each opens that list,
 *    inside the app) and **Public lists**, an exact count;
 *  - their public lists as a grid of cards, flat at rest and lifting under
 *    the pointer (`PublicListCard`), each opening where a list opens inside
 *    the app (`inAppListHref`: Community's list page, or your Lists for your
 *    own).
 *
 * Left out, as everywhere: v7's accuracy tiles and "Accuracy by category"
 * (nothing grades rankings yet — plan C4), its Teams panel (no league data
 * on a profile yet — the manager profile, V.4.3) and the Pro badge.
 *
 * One profile body (`PersonProfileBody`) for the manager profile to extend:
 * it takes extra sections as `children`, under the tiles.
 *
 * The page title is the app's standard header ("Profile") with Back — to
 * where you came from, else Community (or My stats for your own).
 */
export function DesktopPersonProfile({ username }: { username: string }) {
  const { user, profile: me } = useAuth()
  const goBack = useGoBack()
  const person = usePersonProfile(username)
  const data = person.data
  const isOwn = me?.username === username || (Boolean(user) && data?.profile.id === user?.id)

  return (
    <>
      <PageHeader
        title="Profile"
        actions={
          <Button variant="ghost" size="sm" onClick={() => goBack(personProfileParent(isOwn, featureFlags.community))}>
            <Icon name="arrow-prev" size={13} />
            Back
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[833px] flex-col gap-6" data-desktop-person-profile>
        {person.isPending ? (
          <ProfileSkeleton />
        ) : person.isError ? (
          <ReadFailed
            copy="Couldn’t load this profile."
            onRetry={() => void person.refetch()}
            retrying={person.isFetching}
          />
        ) : data === null || data === undefined ? (
          <PersonGone />
        ) : (
          <PersonProfileBody data={data} isOwn={isOwn} />
        )}
      </div>
    </>
  )
}

/**
 * The profile itself — header, tiles, then `children` (the manager
 * profile's sections, later), then the public lists.
 */
export function PersonProfileBody({
  data,
  isOwn,
  children,
}: {
  data: PersonProfileData
  isOwn: boolean
  children?: ReactNode
}) {
  const { profile, lists, listCount } = data
  const listTotal = listCount ?? lists.length
  // The count didn't come back and the page is full: say "20+", never a
  // number that is only where the page stopped.
  const listTotalLabel =
    listCount === null && lists.length >= 20 ? `${lists.length}+` : listTotal.toLocaleString('en-US')

  return (
    <>
      <ProfileHeader
        username={profile.username}
        bio={profile.bio}
        avatarUrl={profile.avatar_url}
        // No Pro badge while the app offers no Pro, and this read carries
        // no Pro flag (PRO_UPSELL_ENABLED is off).
        isPro={false}
        credScore={credOrStart(profile.cred_score)}
        followerCount={profile.follower_count}
        followingCount={profile.following_count}
        isOwn={false}
        followsHref={(kind) => appFollowsHref(profile.username, kind)}
        actions={
          <>
            {isOwn ? (
              <Button asChild variant="stroke" size="md">
                <Link href="/app/settings/profile">
                  <Icon name="edit" />
                  Edit profile
                </Link>
              </Button>
            ) : (
              <FollowButton userId={profile.id} size="md" />
            )}
            <ShareLinkButton href={userProfileHref(profile.username)} size="md" />
          </>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(145px,1fr))] gap-2.5" data-profile-tiles>
        <StatTile
          label="Followers"
          value={profile.follower_count.toLocaleString('en-US')}
          href={appFollowsHref(profile.username, 'followers')}
        />
        <StatTile
          label="Following"
          value={profile.following_count.toLocaleString('en-US')}
          href={appFollowsHref(profile.username, 'following')}
        />
        <StatTile label="Public lists" value={listTotalLabel} />
      </div>

      {children}

      <section className="flex flex-col gap-[9px]" data-profile-lists>
        <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">Public lists</h2>
        {lists.length === 0 ? (
          <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
            <h3 className="text-h6 text-ink">{isOwn ? 'You haven’t shared any lists yet' : 'No public lists yet'}</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-n-6">
              {isOwn
                ? 'Lists you make public show up here, for everyone to see.'
                : 'Lists they make public will show up here.'}
            </p>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,213px),1fr))] gap-2.5">
              {lists.map((l) => (
                // Each card fills its grid cell, so a row of cards ends level.
                <li key={l.id} className="min-w-0 [&>*]:h-full">
                  <PublicListCard
                    href={inAppListHref(l.id, featureFlags.community, { own: isOwn })}
                    title={l.title}
                    description={l.description}
                    positionFilter={l.position_filter}
                    playerCount={l.player_count ?? 0}
                    likeCount={l.like_count ?? 0}
                    updatedAt={l.updated_at}
                    owner={{ username: profile.username, avatar_url: profile.avatar_url }}
                    showOwner={false}
                  />
                </li>
              ))}
            </ul>
            {listCount !== null && listCount > lists.length && (
              <p className="text-[10px] font-medium text-n-6">
                Showing the {lists.length} most recently updated of {listCount.toLocaleString('en-US')} public lists.
              </p>
            )}
          </>
        )}
      </section>
    </>
  )
}

/**
 * A person's Followers or Following on desktop, inside the app shell —
 * `/app/u/[username]/followers|following` while Community is on (plan C6):
 * the profile's tiles and counts open these. The public pages' list body
 * (`PersonFollowsList`) under the app's standard header: the list's name,
 * whose list it is (their @handle, a link back to them), a Followers |
 * Following switch with the profile's counts that flips between the two in
 * place (as the phone's does, so Back is one step to the profile), and Back
 * — to where you came from, else that profile.
 */
export function DesktopPersonFollows({ username, kind }: { username: string; kind: PersonFollowsKind }) {
  const router = useRouter()
  const goBack = useGoBack()
  const follows = usePersonFollows(username, kind)
  // The switch's counts — the profile read the profile page shares.
  const person = usePersonProfile(username)
  const counts = person.data
    ? { followers: person.data.profile.follower_count, following: person.data.profile.following_count }
    : null

  return (
    <>
      <PageHeader
        title={kind === 'followers' ? 'Followers' : 'Following'}
        subtitle={<UsernameLink username={username} />}
        aside={
          <Segment aria-label="Followers and following">
            {FOLLOWS_KINDS.map((k) => (
              <SegmentItem
                key={k.value}
                active={k.value === kind}
                count={counts ? counts[k.value] : null}
                onClick={() => {
                  if (k.value !== kind) router.replace(appFollowsHref(username, k.value), { scroll: false })
                }}
              >
                {k.label}
              </SegmentItem>
            ))}
          </Segment>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => goBack(appProfileHref(username))}>
            <Icon name="arrow-prev" size={13} />
            Back
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5" data-desktop-person-follows={kind}>
        {follows.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-2xl bg-surface-control" />
            ))}
          </div>
        ) : follows.isError ? (
          <ReadFailed
            copy={kind === 'followers' ? 'Couldn’t load the followers.' : 'Couldn’t load who they follow.'}
            onRetry={() => void follows.refetch()}
            retrying={follows.isFetching}
          />
        ) : follows.data === null || follows.data === undefined ? (
          <PersonGone />
        ) : (
          <PersonFollowsList username={follows.data.owner.username} kind={kind} people={follows.data.people} />
        )}
      </div>
    </>
  )
}

/** A read that failed: what happened, and a way to try again — never an
 *  empty-looking profile. */
function ReadFailed({ copy, onRetry, retrying }: { copy: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-2.5 px-[19px] py-10 text-center" data-profile-read-failed>
      <p className="text-[11px] font-semibold text-negative-strong">{copy}</p>
      <Button variant="stroke" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Loading…' : 'Try again'}
      </Button>
    </Card>
  )
}

/** Nobody has this username — said plainly. */
function PersonGone() {
  return (
    <Card className="flex flex-col items-center gap-1.5 px-[19px] py-10 text-center" data-person-not-found>
      <p className="text-[13px] font-bold tracking-[-0.01em] text-ink">We can’t find this person</p>
      <p className="text-[11px] font-medium text-n-6">They may have changed their username.</p>
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-[15px]">
        <Skeleton className="h-[65px] w-[65px] shrink-0 rounded-full bg-surface-control" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-40 rounded-md bg-surface-control" />
          <Skeleton className="h-3 w-56 rounded-md bg-surface-control" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Skeleton className="h-[62px] rounded-2xl bg-surface-control" />
        <Skeleton className="h-[62px] rounded-2xl bg-surface-control" />
        <Skeleton className="h-[62px] rounded-2xl bg-surface-control" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,213px),1fr))] gap-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[84px] rounded-2xl bg-surface-control" />
        ))}
      </div>
    </div>
  )
}
