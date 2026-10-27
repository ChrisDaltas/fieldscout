'use client'

import { useQuery } from '@tanstack/react-query'

import type { PersonFollowsKind } from '@/components/shared/username-link-ops'
import { followKeys } from '@/hooks/use-follows'
import { createBrowserClient } from '@/lib/supabase/client'
import { pageAll } from '@/lib/supabase/page-all'

export interface FollowPerson {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number | null
}

export interface PersonFollowsData {
  /** Whose list this is. */
  owner: { id: string; username: string }
  people: FollowPerson[]
}

const PERSON_COLUMNS = 'id, username, avatar_url, bio, cred_score'

/**
 * Who follows a person, or whom they follow — their phone Followers /
 * Following screen (`/app/u/[username]/followers|following`). The public
 * pages' read (follows ⨝ profiles, newest follow first), drained past
 * PostgREST's 1000-row cap with an exact count so a long list is never
 * silently cut short. `null` = nobody has that username; a failed read
 * throws. Keyed under `followKeys.all`; a follow or unfollow marks it stale
 * without re-reading it, so the rows on screen stay until the list is left
 * (an unfollowed row stays, showing Follow) and the next visit reads it fresh.
 */
export function usePersonFollows(username: string, kind: PersonFollowsKind) {
  return useQuery({
    queryKey: followKeys.personFollows(username, kind),
    queryFn: async (): Promise<PersonFollowsData | null> => {
      const supabase = createBrowserClient()
      const { data: owner, error } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('username', username)
        .maybeSingle()
      if (error) throw error
      if (!owner) return null

      // Followers: rows pointing AT the owner, each row's follower.
      // Following: rows FROM the owner, each row's followed person. The
      // other id is unique within the filter, so it ends the sort (pageAll).
      const rows =
        kind === 'followers'
          ? await pageAll<{ person: FollowPerson | null }>((from, to) =>
              supabase
                .from('follows')
                .select(`person:profiles!follows_follower_id_fkey(${PERSON_COLUMNS})`, { count: 'exact' })
                .eq('following_id', owner.id)
                .order('created_at', { ascending: false })
                .order('follower_id', { ascending: true })
                .range(from, to) as unknown as PromiseLike<{
                data: { person: FollowPerson | null }[] | null
                error: { message: string } | null
                count: number | null
              }>,
            )
          : await pageAll<{ person: FollowPerson | null }>((from, to) =>
              supabase
                .from('follows')
                .select(`person:profiles!follows_following_id_fkey(${PERSON_COLUMNS})`, { count: 'exact' })
                .eq('follower_id', owner.id)
                .order('created_at', { ascending: false })
                .order('following_id', { ascending: true })
                .range(from, to) as unknown as PromiseLike<{
                data: { person: FollowPerson | null }[] | null
                error: { message: string } | null
                count: number | null
              }>,
            )

      return {
        owner: { id: owner.id, username: owner.username },
        people: rows.map((r) => r.person).filter((p): p is FollowPerson => Boolean(p)),
      }
    },
  })
}
