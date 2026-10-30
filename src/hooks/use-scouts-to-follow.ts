'use client'

import { useQuery } from '@tanstack/react-query'

import { shownInCommunityQuery } from '@/components/mobile/community/community-ops'
import { ranksOn } from '@/lib/rankings/ranks-on'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * "Scouts to follow" (plan C4; readiness S1) — desktop Community's side card
 * and the phone's For you shelf, one read for both layouts. It replaced "Top
 * scouts", which ranked by cred: nothing awards cred yet, so every account
 * tied at 7 and the board was only signup order.
 *
 * Who appears: people with at least one public list that has players and
 * that Community shows (`shownInCommunityQuery` — while rankings are off,
 * a list, not a ranking), so following them gives you something to see.
 * Never an AI account — `@fieldscout-ai` and every handle ending in "-ai"
 * (the AI experts, plan question 4: real people only) — and never a
 * half-finished signup's placeholder handle (`user_` + 8 hex characters).
 *
 * The order: most followers first; a tie goes to whoever posted or updated a
 * public list most recently. Read from the lists side — public lists ordered
 * by their owner's follower count, then newest update — so each person's
 * first row is their latest list and people come out in exactly that order.
 * Each next read leaves out everyone already met, so one prolific scout's
 * many lists can never crowd out the people after them.
 *
 * Profiles are read by named columns only (migration 210 made profiles
 * column-level SELECT).
 */

export interface ScoutToFollow {
  id: string
  username: string
  avatar_url: string | null
  /** `profiles.follower_count` (kept by the follows trigger). */
  followers: number
}

/** How many people the card and the shelf suggest. */
export const SCOUTS_TO_FOLLOW_SIZE = 5

/** Lists read per round. A round always meets at least one new person. */
export const SCOUTS_PAGE_SIZE = 25

/** A half-finished signup's placeholder handle, e.g. `user_1a2b3c4d`. */
export const PLACEHOLDER_HANDLE_PATTERN = '^user_[0-9a-f]{8}$'

const PLACEHOLDER_HANDLE = new RegExp(PLACEHOLDER_HANDLE_PATTERN)

/**
 * Is this a handle Scouts to follow never suggests: an AI account
 * (`fieldscout-ai`, or any handle ending in "-ai") or a placeholder handle.
 * The read filters both on the server; this is the same rule on the rows
 * it gets back, so a row can't slip through.
 */
export function hiddenFromScouts(username: string): boolean {
  const handle = username.toLowerCase()
  return handle.endsWith('-ai') || PLACEHOLDER_HANDLE.test(handle)
}

/** The cache key every Scouts to follow read lives under — a follow or
 *  unfollow (`useToggleFollow`) changes the counts it shows. */
export const SCOUTS_TO_FOLLOW_KEY = ['scouts-to-follow'] as const

/**
 * A follow (`delta` 1) or unfollow (-1) of `targetId`, on the rows already
 * shown: that person's count moves at once, nobody moves place — the row
 * stays under the pointer that tapped it. The true count and order load on
 * the next visit.
 */
export function withFollowerChange(
  rows: ScoutToFollow[] | undefined,
  targetId: string,
  delta: 1 | -1,
): ScoutToFollow[] | undefined {
  return rows?.map((row) => (row.id === targetId ? { ...row, followers: Math.max(0, row.followers + delta) } : row))
}

/** "1 follower" / "12 followers" / "1,204 followers". */
export function followersLabel(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'follower' : 'followers'}`
}

type BrowserClient = ReturnType<typeof createBrowserClient>

interface OwnerRow {
  id: string
  username: string
  avatar_url: string | null
  follower_count: number | null
}

interface ListOwnerRow {
  owner_id: string
  owner: OwnerRow | OwnerRow[] | null
}

/**
 * The people to suggest, best first. `ranks` is `ranksOn()` — whether a
 * ranking counts as something Community shows. A failed read throws (the
 * card and shelf say they couldn't load — never an empty board).
 */
export async function fetchScoutsToFollow(
  supabase: BrowserClient,
  { ranks }: { ranks: boolean },
): Promise<ScoutToFollow[]> {
  const scouts: ScoutToFollow[] = []
  const met = new Set<string>()

  while (scouts.length < SCOUTS_TO_FOLLOW_SIZE) {
    let query = supabase
      .from('lists')
      .select('owner_id, owner:profiles!lists_owner_id_fkey!inner(id, username, avatar_url, follower_count)')
      .eq('is_private', false)
      .is('deleted_at', null)
    query = shownInCommunityQuery(query, ranks)
      .not('owner.username', 'ilike', '%-ai')
      .not('owner.username', 'match', PLACEHOLDER_HANDLE_PATTERN)
    if (met.size > 0) query = query.not('owner_id', 'in', `(${[...met].join(',')})`)

    const { data, error } = await query
      .order('owner(follower_count)', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(SCOUTS_PAGE_SIZE)
    if (error) throw error

    const rows = (data ?? []) as unknown as ListOwnerRow[]
    const before = met.size
    for (const row of rows) {
      const owner = firstEmbed(row.owner)
      if (!owner || met.has(owner.id)) continue
      met.add(owner.id)
      if (hiddenFromScouts(owner.username)) continue
      scouts.push({
        id: owner.id,
        username: owner.username,
        avatar_url: owner.avatar_url ?? null,
        followers: owner.follower_count ?? 0,
      })
      if (scouts.length === SCOUTS_TO_FOLLOW_SIZE) break
    }

    // A short page is the end of the lists. A full page always meets someone
    // new (everyone met is left out of the read); if one ever didn't, stop
    // rather than read the same page again.
    if (rows.length < SCOUTS_PAGE_SIZE || met.size === before) break
  }

  return scouts
}

export function useScoutsToFollow() {
  const ranks = ranksOn()
  return useQuery({
    queryKey: [...SCOUTS_TO_FOLLOW_KEY, SCOUTS_TO_FOLLOW_SIZE, ranks],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchScoutsToFollow(createBrowserClient(), { ranks }),
  })
}
