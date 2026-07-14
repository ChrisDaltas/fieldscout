'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/use-auth'
import { createBrowserClient } from '@/lib/supabase/client'

// Follow/unfollow for real user profiles. The `follows` table (follower_id,
// following_id) already carries RLS — SELECT is public, and a user may only
// insert/delete rows where follower_id = auth.uid() — so this mutates through
// the browser Supabase client directly, same pattern (and RLS surface) as the
// rest of the community surface (use-explore-feed). Persona/AI boards are not
// real profiles and are never followable here.

export const followKeys = {
  all: ['follows'] as const,
  followingSet: (userId: string) => ['follows', 'following-set', userId] as const,
}

/**
 * The set of profile ids the signed-in user follows. Every FollowButton reads
 * from this one cached query so a single fetch drives all buttons, and an
 * optimistic toggle updates every button at once. Empty set when logged out.
 */
export function useFollowingIds() {
  const { user } = useAuth()
  const supabase = createBrowserClient()

  return useQuery({
    queryKey: followKeys.followingSet(user?.id ?? 'anon'),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user!.id)

      if (error) throw error
      return new Set((data ?? []).map((r) => r.following_id as string))
    },
    // A follow graph changes rarely within a session; keep it warm.
    staleTime: 60_000,
  })
}

interface ToggleFollowVars {
  targetId: string
  /** Current state — the mutation flips it. */
  isFollowing: boolean
}

/**
 * Follow or unfollow a profile. Optimistically flips the cached following-set
 * so every button for that user updates instantly, and rolls back on error.
 */
export function useToggleFollow() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const supabase = createBrowserClient()
  const key = followKeys.followingSet(user?.id ?? 'anon')

  return useMutation({
    mutationFn: async ({ targetId, isFollowing }: ToggleFollowVars) => {
      if (!user?.id) throw new Error('Not signed in')
      if (targetId === user.id) throw new Error('Cannot follow yourself')

      if (isFollowing) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', targetId)
        if (error) throw error
      } else {
        // Idempotent: (follower_id, following_id) is the PK, so a re-follow
        // conflict is harmless.
        const { error } = await supabase
          .from('follows')
          .upsert(
            { follower_id: user.id, following_id: targetId },
            { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
          )
        if (error) throw error
      }
      return { targetId, nowFollowing: !isFollowing }
    },
    onMutate: async ({ targetId, isFollowing }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Set<string>>(key)
      const next = new Set(prev ?? [])
      if (isFollowing) next.delete(targetId)
      else next.add(targetId)
      qc.setQueryData(key, next)
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => {
      // Refresh the follow set and any follower/following counts that read it.
      qc.invalidateQueries({ queryKey: followKeys.all })
      qc.invalidateQueries({ queryKey: ['explore-feed'] })
    },
  })
}
