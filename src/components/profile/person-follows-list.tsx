import { ProfileListRow } from '@/components/profile/profile-list-row'
import type { PersonFollowsKind } from '@/components/shared/username-link-ops'
import { credOrStart } from '@/lib/cred-tiers'

export interface FollowsListPerson {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number | null
  is_pro?: boolean
}

/**
 * A person's Followers or Following on desktop — the one list body for the
 * public pages (`/u/[username]/followers|following`, server-rendered) and the
 * same lists inside the app (`DesktopPersonFollows`, plan C6): each person's
 * row (`ProfileListRow` — avatar, @handle opening them, cred, Follow) in one
 * flush card, or an empty card that says so in plain words.
 *
 * The page around it owns the title and the way back: the public page's own
 * header, or the app's standard header.
 */
export function PersonFollowsList({
  username,
  kind,
  people,
}: {
  /** Whose list this is. */
  username: string
  kind: PersonFollowsKind
  people: FollowsListPerson[]
}) {
  if (people.length === 0) {
    return (
      <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center" data-follows-empty>
        <h2 className="text-h6 text-ink">{kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-n-6">
          {kind === 'followers' ? (
            <>When scouts follow @{username}, they show up here.</>
          ) : (
            <>Scouts @{username} follows will show up here.</>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
      <ul className="divide-y divide-n-4">
        {people.map((p) => (
          <li key={p.id}>
            <ProfileListRow
              userId={p.id}
              username={p.username}
              avatarUrl={p.avatar_url}
              bio={p.bio}
              credScore={credOrStart(p.cred_score)}
              isPro={p.is_pro ?? false}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
