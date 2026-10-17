'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

export interface ProfileListMeta {
  /** Lists that are weekly ranking boards (`big_board_weekly`) — they belong
   *  to the Rankings segment, not Lists. */
  weeklyBoardIds: string[]
  /** The user's lists with a video attached (`list_links.kind = 'video'`). */
  videoListIds: string[]
}

/**
 * What Profile › Lists needs beyond GET /api/lists, which carries neither:
 * which of the user's lists are weekly ranking boards (the weekly-ranks API
 * files them as ordinary lists, so the collection includes them) and which
 * carry a video, for the handoff's "Video" kind.
 */
export function useMobileProfileListMeta(userId: string | undefined) {
  return useQuery({
    queryKey: ['mobile-profile', 'list-meta', userId ?? 'anon'],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProfileListMeta> => {
      const supabase = createBrowserClient()
      const [weekly, videos] = await Promise.all([
        supabase.from('big_board_weekly').select('list_id').eq('user_id', userId!),
        supabase
          .from('list_links')
          .select('list_id, lists!inner(owner_id)')
          .eq('kind', 'video')
          .eq('lists.owner_id', userId!),
      ])
      if (weekly.error) throw weekly.error
      if (videos.error) throw videos.error
      return {
        weeklyBoardIds: (weekly.data ?? []).map((r) => r.list_id),
        videoListIds: Array.from(new Set((videos.data ?? []).map((r) => r.list_id))),
      }
    },
  })
}
