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
  ranking_mode: string | null
  player_count: number | null
  like_count: number | null
  updated_at: string | null
}

export interface PersonProfileData {
  profile: PersonProfile
  lists: PersonList[]
}

/** The public page's list read, row for row (`/u/[username]`): public,
 *  not the big board, not deleted, newest first, 20 at most. */
export const PERSON_LISTS_LIMIT = 20

/**
 * A person's profile for their phone screen (`/app/u/[username]`): the same
 * reads the public page makes on the server — the profile (profiles are
 * public, `001`) and their public lists. `null` = nobody has that username
 * (said so on screen), never a guessed empty profile; a failed read throws,
 * so the screen says it couldn't load instead of showing an empty one.
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

      const { data: lists, error: listsError } = await supabase
        .from('lists')
        .select('id, title, ranking_mode, player_count, like_count, updated_at')
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
      }
    },
  })
}
