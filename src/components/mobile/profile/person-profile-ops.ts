/**
 * A person's profile on the phone (`/app/u/[username]`) and their Followers /
 * Following (`…/followers`, `…/following`) — the pure half.
 *
 * The handoff draws one profile, your own (`m-profile.md` P0); it draws no
 * page for anyone else, but "usernames link to profile" (D462) and the gap
 * list (§5: "Tapping a person in search opens their profile") send phone
 * users to one. So these screens are the public profile — what `/u/[username]`
 * shows — redrawn in the Profile tab's language (`profile-parts.tsx`) with a
 * Back, inside the app shell (dock, light/dark).
 */

import { listRowSub, plural } from '@/components/mobile/profile/profile-ops'
import type { PersonFollowsKind } from '@/components/shared/username-link-ops'
import { authorAvatarClass } from '@/components/mobile/ui/avatar-colors'

/**
 * Where Back goes when nothing in the app is behind (a shared link opened
 * fresh) — "Back always goes to where you came from" (#27) otherwise. Your
 * own public profile opens from Profile; anyone else's from Community (where
 * people are), or Home while Community is switched off.
 */
export function personProfileParent(isOwn: boolean, communityOn: boolean): string {
  if (isOwn) return '/app/profile'
  return communityOn ? '/app/explore' : '/app'
}

/**
 * A public list's row: the Profile tab's list sub (`5 players · Ranked ·
 * Updated 2d ago`) plus its likes when it has any — the count the public
 * page's list card shows.
 */
export function personListSub(
  list: { player_count: number | null; ranking_mode: string | null; updated_at: string | null; like_count: number | null },
  now: number = Date.now(),
): string {
  const sub = listRowSub(list, false, now)
  const likes = list.like_count ?? 0
  return likes > 0 ? `${sub} · ${plural(likes, 'like', 'likes')}` : sub
}

/** The big avatar's colour when there's no photo: blue for you (your Profile
 *  tab's avatar), else the person's own colour — the one their avatar wears
 *  in Community and search, so they look the same everywhere. */
export function personAvatarClass(isOwn: boolean, profileId: string): string {
  return isOwn ? 'bg-accent' : authorAvatarClass(profileId)
}

export const FOLLOWS_KINDS: ReadonlyArray<{ value: PersonFollowsKind; label: string }> = [
  { value: 'followers', label: 'Followers' },
  { value: 'following', label: 'Following' },
]

/** The segment labels with their counts while the person is known:
 *  `Followers 12` / `Following 3`; the bare word before then. */
export function followsSegmentLabel(kind: PersonFollowsKind, count: number | null): string {
  const word = kind === 'followers' ? 'Followers' : 'Following'
  return count === null ? word : `${word} ${count.toLocaleString('en-US')}`
}

/** The empty list, in plain words — yours, or someone else's. */
export function followsEmptyCopy(kind: PersonFollowsKind, isOwn: boolean): string {
  if (kind === 'followers') return isOwn ? 'No one follows you yet.' : 'No followers yet.'
  return isOwn ? 'You aren’t following anyone yet.' : 'Not following anyone yet.'
}

/** A person row's sub: their cred, then their bio's first line when they
 *  wrote one (the public pages' row shows both). */
export function followRowSub(person: { cred_score: number; bio: string | null }): string {
  const cred = `${person.cred_score.toLocaleString('en-US')} cred`
  const bio = person.bio?.trim().split('\n')[0]?.trim()
  return bio ? `${cred} · ${bio}` : cred
}
