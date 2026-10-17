'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Lists: a list owner's handle, for a list the viewer opened
 * by link that is neither theirs nor saved (the collection only carries the
 * owner for saved lists). Profiles are public (`001`, "viewable by everyone").
 */
export function useMobileListsOwner(ownerId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['mobile-lists', 'owner', ownerId ?? ''],
    enabled: enabled && Boolean(ownerId),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await createBrowserClient()
        .from('profiles')
        .select('username')
        .eq('id', ownerId as string)
        .maybeSingle()
      if (error) throw error
      return (data as { username: string | null } | null)?.username ?? null
    },
  })
}
