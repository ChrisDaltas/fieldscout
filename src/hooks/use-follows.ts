'use client'

import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/use-auth'
import {
  COMMUNITY_LIST_META_KEY,
  withAuthorFollowerChange,
  type CommunityListMeta,
} from '@/hooks/use-mobile-community-detail'
import { SCOUTS_TO_FOLLOW_KEY, withFollowerChange, type ScoutToFollow } from '@/hooks/use-scouts-to-follow'
import { createBrowserClient } from '@/lib/supabase/client'
import { pageAll } from '@/lib/supabase/page-all'

// Follow/unfollow for real user profiles. The `follows` table (follower_id,
// following_id) already carries RLS — SELECT is public, and a user may only
// insert/delete rows where follower_id = auth.uid() — so this mutates through
// the browser Supabase client directly, same pattern (and RLS surface) as the
// rest of the community surface (use-explore-feed). Persona/AI boards are not
// real profiles and are never followable here.

export const followKeys = {
  all: ['follows'] as const,
  followingSet: (userId: string) => ['follows', 'following-set', userId] as const,
  // A person's phone profile carries the counts a follow changes, so it
  // lives under `all` and the toggle's settle refreshes it with everything
  // else. Their Followers / Following lists live under `all` too, but the
  // settle only marks them stale (see refreshAfterFollowToggle).
  person: (username: string) => ['follows', 'person', username] as const,
  personFollowsAll: ['follows', 'person-follows'] as const,
  personFollows: (username: string, kind: 'followers' | 'following') =>
    ['follows', 'person-follows', kind, username] as const,
}

/**
 * What a follow or unfollow refreshes once it settles. The follow set and
 * every count that reads it (a person's profile, the feed) re-read now. A
 * Followers / Following list already on screen keeps the rows it loaded:
 * unfollowing someone from your own Following leaves their row in place,
 * now showing Follow, so a mis-tap can be undone (as on Twitter / Instagram,
 * and the desktop /u page until a reload). The lists are only marked stale,
 * so the next visit to one reads it fresh. Scouts to follow is the same: the
 * toggle already moved the tapped row's "N followers" (`useToggleFollow`),
 * and a re-read now could reorder the rows under the pointer — so it is only
 * marked stale, and the next visit reads the true counts and order.
 */
export function refreshAfterFollowToggle(qc: QueryClient) {
  const listRoot = followKeys.personFollowsAll[1]
  qc.invalidateQueries({ queryKey: followKeys.all, predicate: (q) => q.queryKey[1] !== listRoot })
  qc.invalidateQueries({ queryKey: followKeys.personFollowsAll, refetchType: 'none' })
  qc.invalidateQueries({ queryKey: SCOUTS_TO_FOLLOW_KEY, refetchType: 'none' })
  // A Community list page's author line: the toggle already moved its
  // count (`moveListMetaFollowers`); the next visit reads the server's.
  qc.invalidateQueries({ queryKey: COMMUNITY_LIST_META_KEY, refetchType: 'none' })
  qc.invalidateQueries({ queryKey: ['explore-feed'] })
}

type ScoutsSnapshot = Array<[QueryKey, ScoutToFollow[] | undefined]>

/**
 * A follow or unfollow's optimistic step on Scouts to follow: the tapped
 * person's "N followers" moves at once on every loaded copy (desktop card,
 * phone shelf), nobody changes place (`withFollowerChange`). Returns what
 * was there, for `putBackScouts` if the toggle fails. Its reads aren't
 * cancelled first: cancelling a first read would leave the card loading with
 * nothing left to fetch. A read that lands afterwards just shows the
 * server's count.
 */
export function moveScoutFollowers(qc: QueryClient, targetId: string, isFollowing: boolean): ScoutsSnapshot {
  const prev = qc.getQueriesData<ScoutToFollow[]>({ queryKey: SCOUTS_TO_FOLLOW_KEY })
  qc.setQueriesData<ScoutToFollow[]>({ queryKey: SCOUTS_TO_FOLLOW_KEY }, (rows) =>
    withFollowerChange(rows, targetId, isFollowing ? -1 : 1),
  )
  return prev
}

/** A failed toggle: Scouts to follow back to what it showed before. */
export function putBackScouts(qc: QueryClient, prev: ScoutsSnapshot) {
  for (const [scoutsKey, rows] of prev) qc.setQueryData(scoutsKey, rows)
}

type ListMetaSnapshot = Array<[QueryKey, CommunityListMeta | undefined]>

/**
 * The same step on a Community list page's author line ("@devpro · 0
 * follows" — the phone's, `useMobileCommunityListMeta`): the count beside
 * the name moves with the tap on every loaded page that person made
 * (`withAuthorFollowerChange`). Returns what was there, for
 * `putBackListMeta` if the toggle fails. Not cancelled first, as above.
 */
export function moveListMetaFollowers(qc: QueryClient, targetId: string, isFollowing: boolean): ListMetaSnapshot {
  const prev = qc.getQueriesData<CommunityListMeta>({ queryKey: COMMUNITY_LIST_META_KEY })
  qc.setQueriesData<CommunityListMeta>({ queryKey: COMMUNITY_LIST_META_KEY }, (meta) =>
    withAuthorFollowerChange(meta, targetId, isFollowing ? -1 : 1),
  )
  return prev
}

/** A failed toggle: the list pages' author lines back to what they showed. */
export function putBackListMeta(qc: QueryClient, prev: ListMetaSnapshot) {
  for (const [metaKey, meta] of prev) qc.setQueryData(metaKey, meta)
}

/**
 * Every profile id `followerId` follows — paged past PostgREST's 1000-row
 * cap (`pageAll`, with an exact count), so someone who follows more than
 * 1000 people never has the ones past the 1000th silently dropped (CLAUDE.md
 * "exactly 1000 rows"). `following_id` is unique for one follower (the
 * table's key is the pair), so it ends the sort. A failed page throws.
 */
export async function readFollowingIds(
  supabase: ReturnType<typeof createBrowserClient>,
  followerId: string,
): Promise<string[]> {
  const rows = await pageAll<{ following_id: string }>((from, to) =>
    supabase
      .from('follows')
      .select('following_id', { count: 'exact' })
      .eq('follower_id', followerId)
      .order('following_id', { ascending: true })
      .range(from, to),
  )
  return rows.map((r) => r.following_id)
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
      const rows = await readFollowingIds(supabase, user!.id)
      return new Set(rows)
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
 * so every button for that user updates instantly — and moves that person's
 * "N followers" on any Scouts to follow already loaded, and the count on any
 * of their Community list pages — and rolls all of it back on error.
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
      return {
        prev,
        prevScouts: moveScoutFollowers(qc, targetId, isFollowing),
        prevListMeta: moveListMetaFollowers(qc, targetId, isFollowing),
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      if (ctx?.prevScouts) putBackScouts(qc, ctx.prevScouts)
      if (ctx?.prevListMeta) putBackListMeta(qc, ctx.prevListMeta)
    },
    onSettled: () => refreshAfterFollowToggle(qc),
  })
}
