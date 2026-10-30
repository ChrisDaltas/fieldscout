'use client'

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'

import {
  classifyCommunityList,
  HOME_COMMUNITY_SIZE,
  hottestLikedOutside,
  inAppListHref,
  shownInCommunityQuery,
  sortPopular,
} from '@/components/mobile/community/community-ops'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { pastPoolCursor } from '@/hooks/use-community-older'
import { readFollowingIds } from '@/hooks/use-follows'
import {
  COMMUNITY_POOL_SIZE,
  LIKED_EXTRA_SIZE,
  readRecentLikes,
  type PoolCursor,
} from '@/hooks/use-mobile-community-feed'
import { featureFlags } from '@/lib/feature-flags'
import { ranksOn } from '@/lib/rankings/ranks-on'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * The desktop Community feed (package screen 08). No dedicated feed API
 * exists, so this reads public lists through the browser Supabase client —
 * the same rows and RLS surface as the phone's Community
 * (`use-mobile-community-feed.ts`), and the same rules (plan C3):
 *
 *  - **What shows** (`shownInCommunityQuery`): a list with players in it —
 *    never anyone's empty "My Big Board" — and, while rankings are switched
 *    off (`ranksOn()`), lists only: no big boards, weekly boards or AI
 *    experts' boards, the phone's own split (`classifyCommunityList`).
 *    Filtered in the query, so a page of rows is a page of rows that show.
 *  - **The badge**: "Ranking" only for what `classifyCommunityList` calls a
 *    ranking — not every list whose numbers are on.
 *  - **Popular** is ordered like the phone's For you (ruling #35, "popular +
 *    recent": `sortPopular`), over the same candidates — the most recently
 *    updated lists, plus the lists liked lately that those left out (a like
 *    doesn't update a list). Past the candidates come the older lists, in
 *    update order, so Popular reaches every list too.
 *  - **Newest** is newest posted first; **Following** is Newest from the
 *    people you follow.
 *  - **Paged**: EXPLORE_PAGE_SIZE rows a page, "Load more" reads the next.
 *    Each read asks for one row more than it shows, so a next page is
 *    offered only when there is one — never a silent stop at the first page,
 *    and never a "Load more" that loads nothing.
 *
 * A failed read throws (the feed says "Couldn't load"), the viewer's own
 * likes included — never a feed that quietly shows every list unliked.
 */

export type ExploreFeedTab = 'popular' | 'newest' | 'following'

/** Rows a page shows. */
export const EXPLORE_PAGE_SIZE = 30

export interface ExploreFeedItem {
  id: string
  title: string
  slug: string
  /** `classifyCommunityList` says ranking → "Ranking" badge, else "List". */
  is_ranking: boolean
  /** Persona-authored content keeps its AI badge treatment. */
  is_ai: boolean
  like_count: number
  comment_count: number
  player_count: number
  created_at: string
  /**
   * Identity: the persona for AI boards, else the owner profile. People
   * render as their handle only — `name` is the persona's PUBLIC parody name
   * ("Bathew Merry (AI)") and is null for a human author, for whom FieldScout
   * stores no name at all (ruling 2026-08-05).
   */
  author: {
    name: string | null
    handle: string
    avatar_url: string | null
  }
  /** Where the row opens (`inAppListHref`): while Community is on,
   *  someone else's list on Community's list page and your own on your
   *  Lists; otherwise the public list page (persona boards also live under
   *  the owner profile). */
  href: string
  author_href: string
  /** Owner profile id for the follow control — null for AI-persona boards
   *  (personas aren't real profiles, so they can't be followed here). */
  author_id: string | null
  /** Whether the signed-in viewer has already liked this list. */
  is_liked: boolean
  /** The tag the row shows beside the author: the list's first. */
  tag: { name: string; slug: string } | null
  /** Every tag the list carries. The topic chips are drawn from these, so a
   *  chip is only ever a tag a list on the feed carries (plan C4). */
  tags: FeedTag[]
}

export interface FeedTag {
  id: string
  name: string
  slug: string
}

interface EmbeddedProfile {
  id: string
  username: string
  avatar_url: string | null
}

interface EmbeddedPersona {
  username: string
  display_name: string
  avatar_url: string | null
}

export interface FeedRowShape {
  id: string
  title: string
  slug: string
  is_big_board: boolean | null
  ai_persona_id: string | null
  like_count: number | null
  player_count: number | null
  created_at: string | null
  updated_at: string | null
  owner: EmbeddedProfile | EmbeddedProfile[] | null
  persona: EmbeddedPersona | EmbeddedPersona[] | null
  comments: { count: number }[] | null
  tag_links: { tag: FeedTag | FeedTag[] | null }[] | null
}

/** Every column here has been on production for months — none a migration
 *  not yet pushed adds. */
export const FEED_SELECT = `id, title, slug, is_big_board, ai_persona_id, like_count, player_count, created_at, updated_at,
  owner:profiles!lists_owner_id_fkey(id, username, avatar_url),
  persona:ai_personas!lists_ai_persona_id_fkey(username, display_name, avatar_url),
  comments:list_comments(count),
  tag_links:list_tags(tag:tags(id, name, slug))`

/**
 * Where a page starts.
 *  - `start`: the first page of any tab.
 *  - `offset`: Newest / Following, from this row of the newest-first order.
 *  - `ranked`: Popular, the candidates still to show (already in Popular's
 *    order), then — when the candidates didn't hold every list — the older
 *    lists (`older`).
 *  - `older`: Popular past its candidates, after this row in update order,
 *    leaving out the lists the candidates already showed (`exclude`: the
 *    lists liked lately that came from past the newest ones).
 */
export type ExploreFeedPageParam =
  | { at: 'start' }
  | { at: 'offset'; from: number }
  | { at: 'ranked'; rest: FeedRowShape[]; older: OlderFrom | null }
  | ({ at: 'older' } & OlderFrom)

interface OlderFrom {
  after: PoolCursor
  exclude: string[]
}

export interface ExploreFeedPage {
  items: ExploreFeedItem[]
  /** Where the next page starts; null when this one was the last. */
  next: ExploreFeedPageParam | null
}

export const EXPLORE_FEED_START: ExploreFeedPageParam = { at: 'start' }

export function mapFeedRows(
  rows: FeedRowShape[],
  likedIds: ReadonlySet<string>,
  viewerId: string | null = null,
): ExploreFeedItem[] {
  return rows.flatMap((row) => {
    const owner = firstEmbed(row.owner)
    if (!owner) return []
    const persona = row.ai_persona_id ? firstEmbed(row.persona) : null
    const tags = (row.tag_links ?? []).flatMap((link) => {
      const tag = firstEmbed(link.tag)
      return tag ? [tag] : []
    })

    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        // A ranking is a ranking product — the season board, a weekly board,
        // an AI expert's board — never a list just because it is numbered
        // (nearly every list is, by default). The phone's split.
        is_ranking: classifyCommunityList(row).kind === 'rank',
        is_ai: Boolean(persona),
        like_count: row.like_count ?? 0,
        comment_count: row.comments?.[0]?.count ?? 0,
        player_count: row.player_count ?? 0,
        created_at: row.created_at ?? '',
        author: persona
          ? {
              name: persona.display_name,
              handle: persona.username,
              avatar_url: persona.avatar_url,
            }
          : {
              name: null,
              handle: owner.username,
              avatar_url: owner.avatar_url,
            },
        // Inside the app while Community is on (plan C5): someone else's
        // list on Community's list page, your own on your Lists. Off, the
        // share page, as before.
        href: inAppListHref(row.id, featureFlags.community, {
          own: viewerId !== null && owner.id === viewerId,
          otherwise: `/u/${owner.username}/lists/${row.slug}`,
        }),
        author_href: persona
          ? `/personas/${persona.username}`
          : userProfileHref(owner.username),
        author_id: persona ? null : owner.id,
        is_liked: likedIds.has(row.id),
        tag: tags[0] ? { name: tags[0].name, slug: tags[0].slug } : null,
        tags,
      },
    ]
  })
}

/** Popular's order (the phone's For you, `sortPopular`): rows → rows. */
export function popularOrder(
  rows: readonly FeedRowShape[],
  recentLikes: ReadonlyMap<string, readonly number[]>,
  now: number,
): FeedRowShape[] {
  return sortPopular(
    rows.map((row) => ({
      id: row.id,
      likeCount: row.like_count ?? 0,
      recentLikes: [...(recentLikes.get(row.id) ?? [])],
      updatedAt: row.updated_at ?? row.created_at ?? '',
      row,
    })),
    now,
  ).map((scored) => scored.row)
}

/** The pages in order, each list once — Newest's pages are read by offset,
 *  so a list posted between two reads can push a row already shown onto the
 *  next page. */
export function exploreFeedItems(pages: readonly ExploreFeedPage[]): ExploreFeedItem[] {
  const seen = new Set<string>()
  return pages.flatMap((page) => page.items).filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

/**
 * Home's "From the Community" card on desktop (plan C8): the lists the
 * Popular tab shows, in its order — the phone's For you order, "popular +
 * recent" (ruling #35) — the first `size`. Read through Community's own
 * Popular feed, so the card and the tab its See all opens never disagree.
 * Real lists only, the feed's rule (plan C3): no list without players, and
 * no rankings whatever their switch says — Home's way into Rankings comes
 * with them (plan Stage 2). With rankings on, the card shows the lists
 * among the rows Popular has read so far, never a ranking in their place.
 */
export function homeCommunityItems(
  pages: readonly ExploreFeedPage[],
  size: number = HOME_COMMUNITY_SIZE,
): ExploreFeedItem[] {
  return exploreFeedItems(pages)
    .filter((item) => !item.is_ranking && item.player_count > 0)
    .slice(0, size)
}

/**
 * The like toggle's authoritative count, written into every loaded page —
 * and, when the toggle happened somewhere else (Community's list page, plan
 * C5), whether you now like it (`liked`), so the feed row Back returns to
 * shows the same.
 */
export function withLikeCount(
  data: InfiniteData<ExploreFeedPage, ExploreFeedPageParam> | undefined,
  listId: string,
  likeCount: number,
  liked?: boolean,
): InfiniteData<ExploreFeedPage, ExploreFeedPageParam> | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === listId
          ? { ...item, like_count: likeCount, ...(liked === undefined ? {} : { is_liked: liked }) }
          : item,
      ),
    })),
  }
}

export const exploreFeedKeys = {
  all: ['explore-feed'] as const,
  feed: (tab: ExploreFeedTab, tagId: string | null) =>
    ['explore-feed', tab, tagId ?? 'all'] as const,
}

type Supabase = ReturnType<typeof createBrowserClient>

function asRows(data: unknown): FeedRowShape[] {
  return (data ?? []) as unknown as FeedRowShape[]
}

function cursorOf(row: FeedRowShape): PoolCursor {
  return { updatedAt: row.updated_at, id: row.id }
}

/** Which of these lists the viewer has liked. A failed read throws. */
async function likedAmong(supabase: Supabase, userId: string | null, rows: FeedRowShape[]): Promise<Set<string>> {
  const liked = new Set<string>()
  if (!userId || rows.length === 0) return liked
  const { data, error } = await supabase
    .from('list_likes')
    .select('list_id')
    .eq('user_id', userId)
    .in(
      'list_id',
      rows.map((r) => r.id),
    )
  if (error) throw error
  for (const like of data ?? []) liked.add(like.list_id as string)
  return liked
}

/** One page of the feed: `tab`, the topic chip (`tagId`), from `param`. */
export async function readExploreFeedPage(
  tab: ExploreFeedTab,
  tagId: string | null,
  param: ExploreFeedPageParam,
  now: number = Date.now(),
): Promise<ExploreFeedPage> {
  const supabase = createBrowserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id ?? null
  const ranks = ranksOn()

  /** The public lists the feed shows, before the tab's order and size. */
  const lists = () => {
    // The tag chip filter needs an inner join alias distinct from the
    // display embed, so untagged lists still surface on "All".
    const select = tagId ? `${FEED_SELECT},\n  tag_filter:list_tags!inner(tag_id)` : FEED_SELECT
    let query = supabase
      .from('lists')
      .select(select)
      .eq('is_private', false)
      .is('deleted_at', null)
      // The comment count is live comments only. 213's read rule hides
      // removed ones from every reader; this filter says so before it is
      // pushed too (measured: the embed count honours it).
      .is('comments.deleted_at', null)
    query = shownInCommunityQuery(query, ranks)
    if (tagId) query = query.eq('tag_filter.tag_id', tagId)
    return query
  }

  /** A page of rows already in order; `next` decided by the caller. */
  const page = async (rows: FeedRowShape[], next: ExploreFeedPageParam | null): Promise<ExploreFeedPage> => ({
    items: mapFeedRows(rows, await likedAmong(supabase, userId, rows), userId),
    next,
  })

  if (tab === 'popular') {
    if (param.at === 'ranked') {
      const rest = param.rest.slice(EXPLORE_PAGE_SIZE)
      const older = param.older
      return page(
        param.rest.slice(0, EXPLORE_PAGE_SIZE),
        rest.length > 0 ? { at: 'ranked', rest, older } : older ? { at: 'older', ...older } : null,
      )
    }

    if (param.at === 'older') {
      let query = pastPoolCursor(lists(), param.after)
      if (param.exclude.length > 0) query = query.not('id', 'in', `(${param.exclude.join(',')})`)
      const { data, error } = await query
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(EXPLORE_PAGE_SIZE + 1)
      if (error) throw error
      const rows = asRows(data)
      const shown = rows.slice(0, EXPLORE_PAGE_SIZE)
      const last = shown[shown.length - 1]
      return page(
        shown,
        rows.length > EXPLORE_PAGE_SIZE && last
          ? { at: 'older', after: cursorOf(last), exclude: param.exclude }
          : null,
      )
    }

    // The first page: the candidates For you weighs — the most recently
    // updated lists, and the lists liked lately that those left out — in
    // its order.
    const [pool, recentLikes] = await Promise.all([
      lists()
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(COMMUNITY_POOL_SIZE),
      readRecentLikes(supabase, now),
    ])
    if (pool.error) throw pool.error
    const poolRows = asRows(pool.data)
    const extraIds = hottestLikedOutside(recentLikes, new Set(poolRows.map((r) => r.id)), now, LIKED_EXTRA_SIZE)
    let extraRows: FeedRowShape[] = []
    if (extraIds.length > 0) {
      // Through the same filters: a like on a list that doesn't show simply
      // doesn't come back.
      const extra = await lists().in('id', extraIds)
      if (extra.error) throw extra.error
      extraRows = asRows(extra.data)
    }
    // A full read may not hold every list: the older ones follow.
    const last = poolRows[poolRows.length - 1]
    const older: OlderFrom | null =
      poolRows.length >= COMMUNITY_POOL_SIZE && last
        ? { after: cursorOf(last), exclude: extraRows.map((r) => r.id) }
        : null
    const ranked = popularOrder([...poolRows, ...extraRows], recentLikes, now)
    const rest = ranked.slice(EXPLORE_PAGE_SIZE)
    return page(
      ranked.slice(0, EXPLORE_PAGE_SIZE),
      rest.length > 0 ? { at: 'ranked', rest, older } : older ? { at: 'older', ...older } : null,
    )
  }

  // Newest, and Following (Newest from the people you follow).
  let ownerIds: string[] | null = null
  if (tab === 'following') {
    if (!userId) return { items: [], next: null }
    // Everyone you follow, past PostgREST's 1000-row cap (`readFollowingIds`).
    ownerIds = await readFollowingIds(supabase, userId)
    if (ownerIds.length === 0) return { items: [], next: null }
  }
  let query = lists()
  // The ids go in the request's address, so a very long follow list (a few
  // thousand) would outgrow what a URL can carry; fine at friends-and-testers
  // scale. Past that, filter by the follows on the server instead.
  if (ownerIds) query = query.in('owner_id', ownerIds)
  const from = param.at === 'offset' ? param.from : 0
  const { data, error } = await query
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    // One row past the page: there is a next page only if it came back.
    .range(from, from + EXPLORE_PAGE_SIZE)
  if (error) throw error
  const rows = asRows(data)
  return page(
    rows.slice(0, EXPLORE_PAGE_SIZE),
    rows.length > EXPLORE_PAGE_SIZE ? { at: 'offset', from: from + EXPLORE_PAGE_SIZE } : null,
  )
}

/** The feed, a page at a time (`fetchNextPage` reads the next). */
export function useExploreFeed(tab: ExploreFeedTab, tagId: string | null) {
  return useInfiniteQuery<
    ExploreFeedPage,
    Error,
    InfiniteData<ExploreFeedPage, ExploreFeedPageParam>,
    ReturnType<typeof exploreFeedKeys.feed>,
    ExploreFeedPageParam
  >({
    queryKey: exploreFeedKeys.feed(tab, tagId),
    staleTime: 60 * 1000,
    initialPageParam: EXPLORE_FEED_START,
    queryFn: ({ pageParam }) => readExploreFeedPage(tab, tagId, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
  })
}
