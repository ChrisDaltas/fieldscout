'use client'

import { useQuery } from '@tanstack/react-query'

import { followKeys } from '@/hooks/use-follows'
import { createBrowserClient } from '@/lib/supabase/client'

export interface PersonProfile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  cred_score: number | null
  follower_count: number
  following_count: number
}

export interface PersonList {
  id: string
  title: string
  description: string | null
  position_filter: string | null
  ranking_mode: string | null
  player_count: number | null
  like_count: number | null
  updated_at: string | null
}

export interface PersonProfileData {
  profile: PersonProfile
  /** The newest public lists — at most `PERSON_LISTS_LIMIT`. */
  lists: PersonList[]
  /** How many public lists they have in all (an exact count — more than
   *  `lists` holds once they pass the limit), for the desktop profile's
   *  "Public lists" tile. `null` only if the count didn't come back — never
   *  replaced by the rows on hand, which stop at the limit. */
  listCount: number | null
}

/** The public page's list read, row for row (`/u/[username]`): public,
 *  not the big board, not deleted, newest first, 20 at most. */
export const PERSON_LISTS_LIMIT = 20

/**
 * A person's profile inside the app (`/app/u/[username]` — the phone screen,
 * and the desktop profile while Community is on): the same reads the public
 * page makes on the server — the profile (profiles are public, `001`) and
 * their public lists, with an exact count of them. `null` = nobody has that
 * username (said so on screen), never a guessed empty profile; a failed read
 * throws, so the screen says it couldn't load instead of showing an empty
 * one.
 *
 * Keyed under `followKeys.all`, so following or unfollowing refreshes the
 * follower count on screen.
 */
export function usePersonProfile(username: string) {
  return useQuery({
    queryKey: followKeys.person(username),
    queryFn: async (): Promise<PersonProfileData | null> => {
      const supabase = createBrowserClient()
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, bio, cred_score, follower_count, following_count')
        .eq('username', username)
        .maybeSingle()
      if (error) throw error
      if (!profile) return null

      // The count is exact, so a person with more lists than the page shows
      // is never told they have exactly `PERSON_LISTS_LIMIT`.
      const { data: lists, error: listsError, count } = await supabase
        .from('lists')
        .select('id, title, description, position_filter, ranking_mode, player_count, like_count, updated_at', {
          count: 'exact',
        })
        .eq('owner_id', profile.id)
        .eq('is_private', false)
        .eq('is_big_board', false)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(PERSON_LISTS_LIMIT)
      if (listsError) throw listsError

      return {
        profile: {
          id: profile.id,
          username: profile.username,
          avatar_url: profile.avatar_url ?? null,
          bio: profile.bio ?? null,
          cred_score: profile.cred_score ?? null,
          follower_count: profile.follower_count ?? 0,
          following_count: profile.following_count ?? 0,
        },
        lists: (lists ?? []) as PersonList[],
        listCount: count ?? null,
      }
    },
  })
}
