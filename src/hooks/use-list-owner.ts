'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/** Who made a list: the handle its share link and byline carry, and their picture. */
export interface ListOwner {
  username: string | null
  avatarUrl: string | null
}

/**
 * Lists: the owner of a list the viewer opened by link that is neither theirs
 * nor saved — the collection only carries the owner for saved lists, so
 * without this the list has no author to show. Both layouts read it: the
 * phone's list view and the desktop Lists panel (one helper, not two).
 *
 * Named columns only: since migration 210 `profiles` is column-level SELECT,
 * and `username` / `avatar_url` are both public (`001`, "viewable by
 * everyone"). A failed read throws — the caller shows no author rather than
 * a guessed one.
 */
export function useListOwner(ownerId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['list-owner', ownerId ?? ''],
    enabled: enabled && Boolean(ownerId),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ListOwner | null> => {
      const { data, error } = await createBrowserClient()
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', ownerId as string)
        .maybeSingle()
      if (error) throw error
      const row = data as { username: string | null; avatar_url: string | null } | null
      return row ? { username: row.username ?? null, avatarUrl: row.avatar_url ?? null } : null
    },
  })
}
